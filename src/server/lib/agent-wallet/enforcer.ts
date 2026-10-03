// SLICE-155-2: spend enforcer — the call-site layer over envelope.ts.
// One pattern for every payment entry we control:
//
//   enforcer.begin(c, amountUsd, kind, refId) → EnforceBegin | Response(402)
//   ...payment execution (x402 settle / subscription / pass mint)...
//   enforcer.complete(begun, ok, amountUsd, kind, refId, txHash)
//
// or the middleware form `spendEnvelopeGate({kind, amountUsdFor, refIdFor})`
// (reserve → next() → settle/release by response status), and
// `withEnvelope(...)` for non-middleware call sites.
//
// Wallet identity: agentWallet ctx (verified wallet-sig) → X-Wallet
// header → PAYMENT-SIGNATURE authorization.from (x402 EIP-3009 payer).
// Envelope is a SELF-IMPOSED guardrail — self-declared X-Wallet is
// acceptable for capping (you can only throttle yourself); verified
// agentWallet ctx is preferred when present.
// Unregistered wallets pass opt-in unless requireRegistered (env
// AGENT_WALLET_REQUIRE_REGISTERED=1).

import type { Context, MiddlewareHandler } from "hono";
import { isAddress } from "viem";

import { errorResponse } from "../error-response";
import { ErrorCodes } from "../error-codes";
import type { AgentWalletStore, SpendCaps } from "./registry";
import { newSpendId, type SpendEntry, type SpendKind, type SpendLedger } from "./ledger";
import { reserve } from "./envelope";
import { emitSpendAlert } from "./audit";

/* ------------------------------ wallet resolve ---------------------------- */

/** Best-effort x402 payer extraction from PAYMENT-SIGNATURE (EIP-3009). */
function payerFromPaymentSig(c: Context): string | undefined {
  const hdr = c.req.header("payment-signature");
  if (!hdr) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(hdr, "base64").toString("utf8"),
    ) as Record<string, unknown>;
    const payload = (decoded.payload ?? decoded) as Record<string, unknown>;
    const auth = (payload.authorization ?? payload) as Record<string, unknown>;
    const from = auth.from ?? decoded.from;
    return typeof from === "string" && isAddress(from) ? from : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSpendWallet(c: Context): string | undefined {
  const ctxWallet = c.get("agentWallet") as string | undefined;
  if (ctxWallet && isAddress(ctxWallet)) return ctxWallet.toLowerCase();
  const hdr = c.req.header("x-wallet");
  if (hdr && isAddress(hdr)) return hdr.toLowerCase();
  return payerFromPaymentSig(c)?.toLowerCase();
}

/* ------------------------------- enforcer --------------------------------- */

export interface SpendEnforcerDeps {
  ledger: SpendLedger;
  registry: AgentWalletStore;
  /** AGENT_WALLET_REQUIRE_REGISTERED — deny unregistered wallets. */
  requireRegistered: boolean;
  /** AGENT_WALLET_DEFAULT_CAPS — applied when record has no envelope. */
  defaultCaps?: SpendCaps;
}

export interface EnforceBegin {
  /** Set when a reservation was made (caps applied). */
  entry?: SpendEntry;
  /** Resolved wallet — for post-settle accounting even without caps. */
  wallet?: `0x${string}`;
}

export interface SpendEnforcer {
  /** Returns Response (402 spend_cap) when denied — return it directly. */
  begin(
    c: Context,
    amountUsd: number,
    kind: SpendKind,
    refId: string,
  ): Promise<Response | EnforceBegin>;
  /** Post-execution transition; also records settled spend when no
   *  reservation existed (no caps configured — ledger completeness). */
  complete(
    begun: EnforceBegin,
    ok: boolean,
    amountUsd?: number,
    kind?: SpendKind,
    refId?: string,
    txHash?: string,
  ): void;
}

export function createSpendEnforcer(deps: SpendEnforcerDeps): SpendEnforcer {
  return {
    async begin(c, amountUsd, kind, refId) {
      const wallet = resolveSpendWallet(c);
      if (!wallet || !isAddress(wallet)) {
        if (deps.requireRegistered) {
          return errorResponse(
            c,
            402,
            ErrorCodes.PAYMENT_REQUIRED,
            "spend envelope requires a registered agent wallet",
          );
        }
        return {};
      }
      const rec = deps.registry.get(wallet);
      if (!rec || !rec.active) {
        if (deps.requireRegistered) {
          return errorResponse(
            c,
            402,
            ErrorCodes.PAYMENT_REQUIRED,
            "wallet not registered — POST /api/wallets first",
          );
        }
        return { wallet: wallet as `0x${string}` };
      }
      const caps =
        Object.keys(rec.envelope).length > 0 ? rec.envelope : deps.defaultCaps;
      if (!caps) return { wallet: wallet as `0x${string}` };
      const r = reserve(
        deps.ledger,
        caps,
        wallet as `0x${string}`,
        amountUsd,
        kind,
        refId,
      );
      if (!r.ok) {
        // SLICE-155-6: cap_denied alert — venue sees every denied pay.
        emitSpendAlert(
          "spend.cap_denied",
          rec.address,
          {
            cap: r.deny.cap,
            used: r.deny.used,
            limit: r.deny.limit,
            resetAt: r.deny.resetAt,
            amountUsd,
            kind,
            refId,
          },
          rec.venueId,
        );
        return c.json(
          {
            error: "spend_cap",
            cap: r.deny.cap,
            used: r.deny.used,
            limit: r.deny.limit,
            resetAt: r.deny.resetAt,
          },
          402,
        );
      }
      return { wallet: wallet as `0x${string}`, entry: r.entry };
    },

    complete(begun, ok, amountUsd, kind, refId, txHash) {
      if (begun.entry) {
        deps.ledger.transition(
          begun.entry.id,
          ok ? "settled" : "released",
          txHash,
        );
        // SLICE-155-6: settle tx failed after reserve — alertable.
        if (!ok && begun.wallet) {
          emitSpendAlert(
            "spend.failed",
            begun.wallet,
            { entryId: begun.entry.id, amountUsd, kind, refId },
          );
        }
        return;
      }
      // No reservation (no caps) — still record settled spend so the
      // ledger reflects every platform payment.
      if (ok && begun.wallet && amountUsd !== undefined && kind && refId) {
        deps.ledger.insert({
          id: newSpendId(),
          wallet: begun.wallet,
          amountUsd,
          kind,
          refId,
          state: "settled",
          at: Date.now(),
          ...(txHash ? { txHash: txHash as `0x${string}` } : {}),
        });
      }
    },
  };
}

/* ------------------------- module singleton + gate ------------------------ */

let _enforcer: SpendEnforcer | null = null;

/** Called by wiring when AGENT_WALLET_ENABLED — off = gates pass-through. */
export function initSpendEnforcer(e: SpendEnforcer | null): void {
  _enforcer = e;
}
export function getSpendEnforcer(): SpendEnforcer | null {
  return _enforcer;
}

export interface EnvelopeGateOpts {
  kind: SpendKind;
  /** Resolve payment amount (USD decimal); ≤0 → pass-through. */
  amountUsdFor: (c: Context) => number | Promise<number>;
  refIdFor?: (c: Context) => string;
}

/**
 * Path gate for `app.use(path, gate)` — registered BEFORE route mounts.
 * Enforcer resolved lazily per request so wiring order of store init
 * is irrelevant.
 */
export function spendEnvelopeGate(opts: EnvelopeGateOpts): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "POST") {
      await next();
      return;
    }
    const enforcer = _enforcer;
    if (!enforcer) {
      await next();
      return;
    }
    const amountUsd = await opts.amountUsdFor(c);
    if (!(amountUsd > 0)) {
      await next();
      return;
    }
    const refId =
      opts.refIdFor?.(c) ??
      `${opts.kind}:${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const begun = await enforcer.begin(c, amountUsd, opts.kind, refId);
    if (begun instanceof Response) return begun;
    try {
      await next();
      const tx = (
        c.get("payment") as { transaction?: string } | undefined
      )?.transaction;
      enforcer.complete(begun, c.res.ok, amountUsd, opts.kind, refId, tx);
    } catch (err) {
      enforcer.complete(begun, false, amountUsd, opts.kind, refId);
      throw err;
    }
  };
}

/** `withEnvelope` per spec — direct call-site form for non-middleware code. */
export async function withEnvelope<T>(
  enforcer: SpendEnforcer,
  c: Context,
  args: { amountUsd: number; kind: SpendKind; refId: string },
  fn: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; res: Response }> {
  const begun = await enforcer.begin(c, args.amountUsd, args.kind, args.refId);
  if (begun instanceof Response) return { ok: false, res: begun };
  try {
    const result = await fn();
    enforcer.complete(begun, true, args.amountUsd, args.kind, args.refId);
    return { ok: true, result };
  } catch (err) {
    enforcer.complete(begun, false, args.amountUsd, args.kind, args.refId);
    throw err;
  }
}
