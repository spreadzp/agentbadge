/**
 * Payer-binding middleware (EPIC-171, SLICE-171-2/3).
 *
 * Anti-sniping for self-settle x402 rails: the payment txHash is public
 * on-chain, so a request presenting `PAYMENT-SIGNATURE: {txHash}` must
 * also prove ownership of the paying wallet via an EIP-191 signature
 * over the canonical `agentbadge-pay:v1` challenge (payRef = txHash).
 *
 * Ordering (D-171-4, landmine): every rejection runs BEFORE any
 * facilitator/handle `verify()` — a foreign txHash with missing or
 * invalid binding cannot consume the replay slot (elizaOS #10964
 * griefing class).
 *
 * Headers: X-Wallet (payer), X-Sig (EIP-191 over challenge),
 * X-Timestamp (unix seconds, ±300s skew — same as agent-auth).
 * Challenge format lives in @agentbadge/circle-payments payer-bind.ts.
 *
 * Two integration styles:
 *   - `payerBinding()` middleware — mount before a payment gate
 *     (PAYMENT-SIGNATURE absent → passthrough + `payerBindRequired`).
 *   - `checkPayerBinding()` — composable core for gates that branch
 *     internally (bstockFreemium calls it on its paid branch, 171-3).
 *
 * Bypass paths (151-7 pass bypass, free tier, health) never carry
 * PAYMENT-SIGNATURE, so binding never applies to them.
 */

import type { Context, MiddlewareHandler } from "hono";
import { isAddress } from "viem";
import { buildPayerChallenge } from "@agentbadge/circle-payments";
import { logger } from "@agentbadge/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import {
  resolveEnabled,
  resolveVerifier,
  verifyPayerSigCached,
  type VerifyPayerSigFn,
} from "../lib/payer-bind-verify";

export {
  configurePayerBindingForTesting,
  resetPayerBindingForTesting,
} from "../lib/payer-bind-verify";
export type { VerifyPayerSigFn } from "../lib/payer-bind-verify";

const MAX_SKEW_SECONDS = 300;

/** Declaration merged into 402 payloads — client-visible requirement. */
export const PAYER_BINDING_DECLARATION = {
  required: true,
  challenge: "agentbadge-pay:v1",
  headers: ["X-Wallet", "X-Sig", "X-Timestamp"],
  payRef: "PAYMENT-SIGNATURE.payload.txHash",
} as const;

export interface PayerBindVariables {
  /** Lower-cased wallet that signed the payer-binding challenge. */
  payerBindWallet: string;
  /** True when binding was skipped because no payment header was
   *  present — integrations merge the declaration into their 402. */
  payerBindRequired: boolean;
}

/** Peek at the on-chain payer for the presented payment (no slot
 *  claim). Return undefined when unresolvable — downstream verify will
 *  reject the payment anyway. */
export type ResolvePayerFn = (
  paymentHeader: string,
) => Promise<string | undefined>;

export interface PayerBindingOptions {
  /** Gate getter — default reads PAYER_BIND_ENABLED env (live flip). */
  enabled?: () => boolean;
  /** Surface group for the per-group kill-switch
   *  PAYER_BIND_DISABLED_GROUPS (comma list, e.g. "eaas,bstock").
   *  Binding stays off for listed groups while others keep working. */
  group?: string;
  /** EIP-191 verifier — default viem verifyMessage (EOA local,
   *  ERC-1271/6492 via RPC, cached). Injectable for tests. */
  verifier?: VerifyPayerSigFn;
  /** On-chain payer peek — wire to the rail's claim-free inspect.
   *  Omit = post-verify compare only (valid-sig foreign-txHash
   *  griefing still possible). */
  resolvePayer?: ResolvePayerFn;
  /** Extract txHash from PAYMENT-SIGNATURE — default decodes base64
   *  JSON and reads payload.txHash / txHash. */
  extractPayRef?: (paymentHeader: string) => string | undefined;
}

/** txHash normalization — lower-case in challenge AND dedup. */
export function normalizeTxHash(txHash: string): string {
  return txHash.toLowerCase();
}

/** Default: decode base64 JSON payment payload → txHash. */
export function extractPayRefFromPaymentHeader(
  header: string,
): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(header, "base64").toString("utf-8"),
    ) as { payload?: { txHash?: string }; txHash?: string };
    const h = payload?.payload?.txHash ?? payload?.txHash;
    return typeof h === "string" && h.startsWith("0x") ? h : undefined;
  } catch {
    return undefined;
  }
}

/** Live env gate — read per request so the kill-switch flips without a
 *  restart. Default OFF (opt-in rollout per route group). */
export function payerBindEnabled(): boolean {
  return process.env.PAYER_BIND_ENABLED === "true";
}

/** Resolved gate state for this request (test override > option > env)
 *  AND the group kill-switch (PAYER_BIND_DISABLED_GROUPS). */
export function payerBindingActive(
  opts?: Pick<PayerBindingOptions, "enabled" | "group">,
): boolean {
  const on = (resolveEnabled(opts?.enabled) ?? payerBindEnabled)();
  if (!on || !opts?.group) return on;
  const disabled = new Set(
    (process.env.PAYER_BIND_DISABLED_GROUPS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return !disabled.has(opts.group.toLowerCase());
}

function payerBindingRequiredResponse(c: Context): Response {
  const payload = {
    x402Version: 2,
    error: "Payer binding required",
    code: ErrorCodes.INVALID_INPUT,
    payerBinding: PAYER_BINDING_DECLARATION,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return c.json(payload, 402, { "PAYMENT-REQUIRED": encoded });
}

const deny403 = (c: Context, msg: string) =>
  errorResponse(c, 403, ErrorCodes.WRONG_SIGNER, msg);

export type PayerBindingCheck =
  | { ok: true }
  | { ok: false; response: Response };

/**
 * Composable binding check — call ONLY when PAYMENT-SIGNATURE is
 * present and the gate is on (see payerBindingActive). Every rejection
 * is returned as a Response the caller must propagate; on success
 * `payerBindWallet` is set on ctx for the post-verify payer compare.
 */
export async function checkPayerBinding(
  c: Context,
  opts: PayerBindingOptions = {},
): Promise<PayerBindingCheck> {
  const paymentHeader = c.req.header("payment-signature")!;
  const extractPayRef = opts.extractPayRef ?? extractPayRefFromPaymentHeader;

  const wallet = c.req.header("x-wallet");
  const signature = c.req.header("x-sig");
  const timestampRaw = c.req.header("x-timestamp");
  const payRef = extractPayRef(paymentHeader);
  // No txHash → the presented payment is NOT an arc-self-settle payload
  // (gateway/exact rail on a multi-rail surface, or garbage that verify
  // will reject anyway). Binding is a self-settle concern — skip.
  if (!payRef) return { ok: true };
  if (!wallet || !signature || !timestampRaw) {
    return { ok: false, response: payerBindingRequiredResponse(c) };
  }

  if (!isAddress(wallet)) {
    return { ok: false, response: deny403(c, "Invalid X-Wallet address") };
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, response: deny403(c, "Invalid X-Timestamp") };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > MAX_SKEW_SECONDS) {
    return {
      ok: false,
      response: deny403(c, "X-Timestamp outside ±300s skew window"),
    };
  }

  const message = buildPayerChallenge({
    wallet,
    method: c.req.method,
    path: c.req.path,
    payRef: normalizeTxHash(payRef),
    timestamp,
  });

  const valid = await verifyPayerSigCached(
    resolveVerifier(opts.verifier),
    wallet,
    message,
    signature,
  );
  if (!valid) {
    logger.warn("payer-binding: signature verification failed", {
      wallet,
      path: c.req.path,
    });
    return {
      ok: false,
      response: deny403(c, "Payer-binding signature verification failed"),
    };
  }

  // Pre-verify payer match: a valid signature from a wallet that is
  // NOT the on-chain payer must not consume the dedup slot either.
  if (opts.resolvePayer) {
    let onChainPayer: string | undefined;
    try {
      onChainPayer = await opts.resolvePayer(paymentHeader);
    } catch (err) {
      logger.error("payer-binding: resolvePayer failed", {
        err: String(err),
      });
      onChainPayer = undefined;
    }
    if (onChainPayer && onChainPayer.toLowerCase() !== wallet.toLowerCase()) {
      return {
        ok: false,
        response: deny403(
          c,
          "Payer mismatch: X-Wallet is not the transaction sender",
        ),
      };
    }
  }

  c.set("payerBindWallet", wallet.toLowerCase());
  return { ok: true };
}

/**
 * payerBinding — apply to a paid route BEFORE the payment
 * middleware/facilitator call. See file header for the full contract.
 */
export function payerBinding(
  opts: PayerBindingOptions = {},
): MiddlewareHandler<{ Variables: PayerBindVariables }> {
  return async (c, next) => {
    if (!payerBindingActive(opts)) {
      await next();
      return;
    }

    const paymentHeader = c.req.header("payment-signature");
    if (!paymentHeader) {
      // Pre-payment request — downstream produces the 402 with accepts
      // + payerBinding declaration. Never a rejection here.
      c.set("payerBindRequired", true);
      await next();
      return;
    }

    // Payment presented — binding is mandatory; every rejection below
    // happens BEFORE facilitator.verify (dedup slot never burned).
    const check = await checkPayerBinding(c, opts);
    if (!check.ok) return check.response;
    await next();
  };
}
