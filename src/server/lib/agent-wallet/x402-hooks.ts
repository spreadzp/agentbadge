// SLICE-155-4: spend-envelope hooks bound into requirePayment.
// Package middleware calls onBeforeSettle post-verify (payer is
// verified — strongest identity per D6-CONTEXT) pre-settle; returning
// a Response aborts the payment (402 spend_cap). onSettleResult
// settles/releases the reservation — settle-fail frees the cap.
// Enforcer resolved lazily per request → feature-off = zero hooks.

import type { Context } from "hono";
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentInfo,
} from "@agentbadge/circle-payments";

import { getSpendEnforcer, type EnforceBegin } from "./enforcer";
import type { SpendKind } from "./ledger";

const CTX_KEY = "_spendBegun";
const ATOMIC = 1e6;

/** Path → SpendKind for ledger attribution. */
function kindFor(path: string): SpendKind {
  if (path.startsWith("/api/eaas/")) return "eaas";
  if (path.endsWith("/subscribe")) return "subscription";
  return "x402";
}

const refIdFor = (c: Context) =>
  `x402:${c.req.method} ${c.req.path}`;

export interface SpendX402Hooks {
  onBeforeSettle?: (args: {
    c: Context;
    paymentPayload: PaymentPayload;
    requirements: PaymentRequirements;
    payer?: string;
  }) => Promise<Response | void>;
  onSettleResult?: (args: {
    c: Context;
    ok: boolean;
    payment?: PaymentInfo;
    error?: string;
  }) => Promise<void> | void;
}

/** Bound hooks for `requirePayment` — no-ops when feature off. */
export function createSpendX402Hooks(): SpendX402Hooks {
  return {
    onBeforeSettle: async ({ c, requirements }) => {
      const enforcer = getSpendEnforcer();
      if (!enforcer) return;
      const amountUsd = Number(requirements.amount) / ATOMIC;
      const res = await enforcer.begin(
        c,
        amountUsd,
        kindFor(c.req.path),
        refIdFor(c),
      );
      if (res instanceof Response) return res;
      c.set(CTX_KEY, res);
      return;
    },
    onSettleResult: ({ c, ok, payment }) => {
      const enforcer = getSpendEnforcer();
      const begun = c.get(CTX_KEY) as EnforceBegin | undefined;
      if (!enforcer || !begun) return;
      enforcer.complete(
        begun,
        ok,
        payment ? Number(payment.amount) / ATOMIC : undefined,
        kindFor(c.req.path),
        refIdFor(c),
        payment?.transaction,
      );
    },
  };
}
