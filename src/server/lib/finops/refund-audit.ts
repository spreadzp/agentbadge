/**
 * EPIC-226 / SLICE-226-6 round-3 — shared refund audit rows (split
 * out of stripe-refunds.ts / refund-completion.ts for the 300-line
 * arch cap; both refund paths write the same vocabulary).
 *
 * Audit vocabulary on `action: "REFUND"`, `subjectType: "payment"`:
 *   STRIPE_REFUND_INITIATED / STRIPE_REFUND / STRIPE_REFUND_FAILED /
 *   STRIPE_REFUND_UNCERTAIN — paired by `initiationId` (M-6); only
 *   FAILED/STRIPE_REFUND release the in-flight lock the intent path
 *   checks (UNCERTAIN keeps it: money may still be moving).
 *   INTENT_OPENED / INTENT_COMPLETING / INTENT_COMPLETED /
 *   INTENT_COMPLETE_REJECTED.
 */

import type { Database } from "@agentbadge/database";

import {
  recordAdminAction,
  recordPostEffectAudit,
} from "./admin-actions";
import { normalizeOperator } from "./guards";

/**
 * Terminal/uncertain Stripe outcome row — `initiationId` pairs it
 * with its INITIATED row so the in-flight lock cannot mis-order.
 * Post-effect helper: the provider call already happened, an
 * oversized row degrades to minimal evidence rather than vanishing.
 */
export async function auditStripeOutcome(
  db: Database,
  input: { paymentId: string; operator: string },
  evidence: Record<string, unknown>,
): Promise<boolean> {
  const minimal: Record<string, unknown> = {
    kind: evidence.kind,
    initiationId: evidence.initiationId,
    ...(typeof evidence.stripeRefundId === "string"
      ? { stripeRefundId: evidence.stripeRefundId }
      : {}),
    degraded: true,
  };
  const r = await recordPostEffectAudit(
    db,
    {
      action: "REFUND",
      subjectType: "payment",
      subjectId: input.paymentId,
      operator: input.operator,
      evidence,
    },
    minimal,
  );
  return r.ok;
}

/**
 * N12: rejected refund-intent completions are security events —
 * bound + audit the reason and the (normalized) hash.
 */
export async function auditRejectedCompletion(
  db: Database,
  input: { intentId: string; operator: string },
  intentPaymentId: string | undefined,
  txHash: string | null,
  reason: string,
): Promise<void> {
  if (intentPaymentId === undefined) return;
  await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: intentPaymentId,
    operator: normalizeOperator(input.operator),
    evidence: {
      kind: "INTENT_COMPLETE_REJECTED",
      intentId: input.intentId,
      txHash: txHash ?? "invalid",
      reason: reason.slice(0, 200),
    },
  });
}
