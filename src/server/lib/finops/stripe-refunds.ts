/**
 * EPIC-226 / SLICE-226-6 — Stripe refund path (D-226-4 second arm;
 * H3 hardening).
 *
 * The provider call sits between two audit rows on purpose:
 * STRIPE_REFUND_INITIATED (with the idempotency key) is written BEFORE
 * the external call — a refund attempt without a trail is impossible
 * without also failing the audit store — and STRIPE_REFUND completes
 * the record with the provider's refund id and status. The
 * idempotency key `refund:<paymentId>` makes Stripe-side retries of
 * the same payment collapse into one refund instead of duplicating.
 * A payment with manual refund intents is rejected — the Stripe path
 * refunds the full amount and would silently over-refund otherwise
 * (C2). `reason`/`evidence` travel into the audit evidence; only
 * Stripe-enum reasons reach the provider.
 */

import type { Database } from "@agentbadge/database";

import { recordAdminAction } from "./admin-actions";
import {
  MAX_TEXT_FIELD,
  checkEvidence,
  checkTextField,
  normalizeOperator,
  requireOperator,
} from "./guards";
import { refundUsage } from "./refund-intents";
import {
  type FinOpsResult,
  type StripeRefundClient,
  fail,
  ok,
} from "./types";

export interface StripeRefundInput {
  paymentId: string;
  operator: string;
  /** Free-form ops justification — audit evidence + Stripe enum map. */
  reason?: string;
  /** Supporting details — audit evidence only, never sent to Stripe. */
  evidence?: unknown;
}

export interface StripeRefundResult {
  stripeRefundId: string;
  paymentId: string;
  /** true when the payment left revenue as REFUNDED. */
  paymentFlip: boolean;
}

const STRIPE_REASONS = new Set([
  "duplicate",
  "fraudulent",
  "requested_by_customer",
]);
const stripeReason = (reason?: string): string | undefined =>
  reason !== undefined && STRIPE_REASONS.has(reason) ? reason : undefined;

/**
 * Stripe auto path — provider API call, refund id is the evidence.
 * Requires a STRIPE attempt carrying a providerReference (the
 * PaymentIntent id); marks the payment REFUNDED via the guarded
 * transition after the provider call succeeds.
 */
export async function stripeRefund(
  db: Database,
  input: StripeRefundInput,
  stripe: StripeRefundClient,
): Promise<FinOpsResult<StripeRefundResult>> {
  // --- all guards BEFORE the audit-initiated row -------------------
  const op = requireOperator(input.operator);
  if (op) return op as FinOpsResult<never>;
  const ev = checkEvidence(input.evidence);
  if (ev) return ev as FinOpsResult<never>;
  if (input.reason !== undefined) {
    const cap = checkTextField(input.reason, "reason", MAX_TEXT_FIELD);
    if (cap) return cap;
  }
  const payment = await db.payments.payments.getById(input.paymentId);
  if (!payment) return fail("NOT_FOUND", `payment not found: ${input.paymentId}`);
  if (payment.status !== "CONFIRMED") {
    return fail(
      "INVALID_STATE",
      `stripe refund requires CONFIRMED payment, got ${payment.status}`,
    );
  }
  const attempts = await db.payments.attempts.listByPayment(payment.id);
  // M6: prefer the CONFIRMED attempt — an abandoned/duplicate Stripe
  // attempt must not refund an unrelated PaymentIntent.
  const stripeAttempt =
    attempts.find(
      (a) =>
        a.provider === "STRIPE" &&
        a.status === "CONFIRMED" &&
        a.providerReference,
    ) ??
    attempts.find((a) => a.provider === "STRIPE" && a.providerReference);
  if (!stripeAttempt?.providerReference) {
    return fail(
      "INVALID_STATE",
      "no STRIPE attempt with a provider reference — cannot auto-refund",
    );
  }
  // C2: manual intents reserve refund capacity — a full Stripe refund
  // on top of them would exceed the payment amount.
  const { count } = await refundUsage(db, payment.id);
  if (count > 0) {
    return fail(
      "INVALID_STATE",
      "manual refund intents exist — use the intent path or complete them first",
    );
  }
  const operator = normalizeOperator(input.operator);
  const idempotencyKey = `refund:${payment.id}`;
  // H2: initiated audit row BEFORE the external effect — an unaudited
  // refund attempt requires the audit store itself to be down.
  const initiated = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: payment.id,
    operator,
    evidence: {
      kind: "STRIPE_REFUND_INITIATED",
      idempotencyKey,
      attemptId: stripeAttempt.id,
      paymentIntent: stripeAttempt.providerReference,
      reason: input.reason ?? null,
    },
  });
  if (!initiated.ok) return initiated;
  let refund: { id: string; status?: string };
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: stripeAttempt.providerReference,
        ...(stripeReason(input.reason) !== undefined
          ? { reason: stripeReason(input.reason) }
          : {}),
        metadata: { paymentId: payment.id },
      },
      { idempotencyKey },
    );
  } catch (e) {
    return fail(
      "PROVIDER_ERROR",
      `stripe refund failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // Provider must report the refund actually succeeded — a pending or
  // failed refund is not a confirmation (H3).
  if (refund.status !== undefined && refund.status !== "succeeded") {
    return fail(
      "PROVIDER_ERROR",
      `stripe refund ${refund.id} reports status ${refund.status}, not succeeded`,
    );
  }
  const audit = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: payment.id,
    operator,
    evidence: {
      stripeRefundId: refund.id,
      attemptId: stripeAttempt.id,
      idempotencyKey,
      status: refund.status ?? "succeeded",
      reason: input.reason ?? null,
      details: input.evidence ?? null,
      kind: "STRIPE_REFUND",
    },
  });
  if (!audit.ok) return audit;
  const flipped = await db.payments.payments.applyStatus(
    payment.id,
    "CONFIRMED",
    "REFUNDED",
    Date.now(),
  );
  return ok({
    stripeRefundId: refund.id,
    paymentId: payment.id,
    paymentFlip: flipped !== null,
  });
}
