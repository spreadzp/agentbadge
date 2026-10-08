/**
 * EPIC-171 (SLICE-171-4): shared payer-binding helpers for surfaces that
 * gate through `runtime.paymentForPrice` → requirePayment (multi-rail
 * router: gateway + exact + arc self-settle).
 *
 * - `createArcPayerPeek` — claim-free resolvePayer for a surface: reads
 *   the receipt via `ArcSelfSettleHandle.inspect` with `amount:"0"` so
 *   ANY USDC transfer to the arc-rail payTo identifies the on-chain
 *   payer (price-agnostic — works for dynamic-priced surfaces).
 * - `payerBindSettleGuard` — `onBeforeSettle` composer: post-verify
 *   payer compare (`verifyResult.payer === payerBindWallet`), the
 *   defense-in-depth behind the pre-verify peek.
 * - `withPayerBindDecl` — wraps PaymentForOpts: dynamic `payerBinding`
 *   in 402 `extensions` (live per-request) + `accepts[].extra` merge
 *   when the group gate is on at mount + settle guard composition.
 */

import {
  ARC_MAINNET,
  ARC_TESTNET,
  buildArcSelfSettleRequirements,
  type ArcSelfSettleHandle,
  type RequirePaymentOptions,
} from "@agentbadge/circle-payments";
import { ErrorCodes } from "./error-codes";
import { errorResponse } from "./error-response";
import {
  PAYER_BINDING_DECLARATION,
  payerBindingActive,
  type ResolvePayerFn,
} from "../middleware/payer-binding";

/** Decode PAYMENT-SIGNATURE → payload object (same as arc-facilitator). */
function decodePaymentHeader(header: string): unknown {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return header;
  }
}

/**
 * Claim-free on-chain payer peek for a paymentForPrice surface.
 * `handle` = runtime.arcSelfSettle; absent → undefined (binding falls
 * back to signature-only + post-verify compare). `payTo` = the ARC
 * rail's payTo for this surface (marketplace buy pays treasury, not
 * the splitter — check perRailPayTo).
 */
export function createArcPayerPeek(
  handle: ArcSelfSettleHandle | undefined,
  payTo: string,
): ResolvePayerFn | undefined {
  if (!handle) return undefined;
  // amount "0" — findPaymentTransfer matches any USDC transfer to
  // payTo; only the payer identity matters here, not the price.
  const chain = handle.network === ARC_MAINNET.caip2 ? ARC_MAINNET : ARC_TESTNET;
  const requirements = buildArcSelfSettleRequirements(chain, "0", payTo);
  return async (paymentHeader) => {
    try {
      const res = await handle.inspect(
        decodePaymentHeader(paymentHeader),
        requirements,
      );
      return res.ok ? res.payer : undefined;
    } catch {
      return undefined; // unresolvable → verify decides
    }
  };
}

/**
 * Post-verify payer compare for requirePayment opts. Runs after verify
 * (slot already claimed — the peek is what protects the slot) and
 * before settle: a bound wallet that is not the on-chain payer gets
 * 403 instead of the content.
 */
export function payerBindSettleGuard(
  inner?: RequirePaymentOptions["onBeforeSettle"],
): NonNullable<RequirePaymentOptions["onBeforeSettle"]> {
  return async (args) => {
    const bound = args.c.get("payerBindWallet") as string | undefined;
    if (bound && args.payer && args.payer.toLowerCase() !== bound) {
      return errorResponse(
        args.c,
        403,
        ErrorCodes.WRONG_SIGNER,
        "Payer mismatch: X-Wallet is not the transaction sender",
      );
    }
    return inner?.(args);
  };
}

type ExtensionsOpt = RequirePaymentOptions["extensions"];

/** Wrap payment opts: declaration into 402 (extensions — live per
 *  request; accepts[].extra — when group active at mount) + compose
 *  the post-verify settle guard over any existing onBeforeSettle. */
export function withPayerBindDecl<
  T extends {
    extensions?: ExtensionsOpt;
    extraRequirements?: Record<string, unknown>;
    onBeforeSettle?: RequirePaymentOptions["onBeforeSettle"];
  },
>(opts: T, group: string): T {
  const { extensions, extraRequirements, onBeforeSettle } = opts;
  const decl = { payerBinding: PAYER_BINDING_DECLARATION };
  return {
    ...opts,
    extensions: async () => {
      const base =
        typeof extensions === "function" ? await extensions() : extensions;
      const add = payerBindingActive({ group }) ? decl : undefined;
      if (!base && !add) return undefined;
      return { ...base, ...add };
    },
    extraRequirements: {
      ...extraRequirements,
      ...(payerBindingActive({ group }) ? decl : {}),
    },
    onBeforeSettle: payerBindSettleGuard(onBeforeSettle),
  };
}
