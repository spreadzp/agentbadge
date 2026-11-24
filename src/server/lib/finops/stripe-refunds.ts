/**
 * EPIC-226 / SLICE-226-6 — Stripe refund path (D-226-4 second arm;
 * H3 hardening; round-3 M-2/M-6/M-7, round-4 N4-5/N4-6).
 *
 * The provider call sits between two audit rows on purpose:
 * STRIPE_REFUND_INITIATED (idempotency key + initiationId) BEFORE
 * the external call — a refund attempt without a trail is
 * impossible without also failing the audit store — and a paired
 * terminal row (STRIPE_REFUND / _FAILED / _UNCERTAIN; UNCERTAIN
 * does NOT release the in-flight lock — see stripe-resolution.ts
 * for the manual resolution path). Idempotency key
 * `refund:<paymentId>` collapses Stripe-side retries. A payment
 * with manual refund intents is rejected — the Stripe path
 * refunds the full amount and would over-refund otherwise (C2).
 * N4-5: requires exactly ONE CONFIRMED Stripe settlement.
 */

import type { Database } from "@agentbadge/database";

import {
  recordAdminAction,
  recordPostEffectAudit,
} from "./admin-actions";
import { auditStripeOutcome } from "./refund-audit";
import {
  MAX_TEXT_FIELD,
  boundedEvidence,
  checkEvidence,
  checkSerialized,
  checkTextField,
  normalizeOperator,
  requireOperator,
} from "./guards";
import {
  LockAcquireTimeoutError,
  withLock,
} from "./payment-mutex";
import {
  PROVIDER_TIMEOUT_MS,
  isDefiniteProviderRejection,
  stripeReason,
  withTimeout,
} from "./provider-utils";
import { refundUsage } from "./refund-intents";
import {
  type FinOpsResult,
  type StripeRefundClient,
  type StripeRefundInput,
  type StripeRefundResult,
  fail,
  ok,
} from "./types";

/** Stripe auto path — provider API call, refund id is the evidence. */
export async function stripeRefund(
  db: Database,
  input: StripeRefundInput,
  stripe: StripeRefundClient,
): Promise<FinOpsResult<StripeRefundResult>> {
  // N8: serialize per payment — a Stripe refund and an intent create
  // racing on the same payment must not interleave past the checks.
  try {
    return await withLock("pay", input.paymentId, () =>
      stripeRefundInner(db, input, stripe),
    );
  } catch (e) {
    if (e instanceof LockAcquireTimeoutError) {
      return fail(
        "PROVIDER_ERROR",
        `mutation queue busy for payment ${input.paymentId} — retry`,
      );
    }
    throw e;
  }
}

async function stripeRefundInner(
  db: Database,
  input: StripeRefundInput,
  stripe: StripeRefundClient,
): Promise<FinOpsResult<StripeRefundResult>> {
  // --- all guards BEFORE the audit-initiated row -------------------
  const op = requireOperator(input.operator);
  if (op) return op as FinOpsResult<never>;
  const ev = checkEvidence(input.evidence);
  if (ev) return ev as FinOpsResult<never>;
  // L-7: caller evidence is wrapped into the completion row under a
  // 1 KB budget — reject oversized payloads up front instead of
  // silently dropping the operator's justification after the fact.
  if (input.evidence !== undefined && input.evidence !== null) {
    const serialized = JSON.stringify(input.evidence).length;
    if (serialized > 1024) {
      return fail(
        "BAD_INPUT",
        `evidence exceeds the stripe-path audit budget (1024 serialized bytes, got ${serialized}) — keep justification fields under 1 KB`,
      );
    }
  }
  if (input.reason !== undefined) {
    const cap =
      checkTextField(input.reason, "reason", MAX_TEXT_FIELD) ??
      // M-2: the reason lands verbatim in TWO audit rows — cap its
      // serialized size; 512 control chars expand ~6x under
      // JSON.stringify and overflow the 4 KB row after the refund.
      checkSerialized(input.reason, "reason", 700);
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
  // M-7 + N4-5: exactly ONE CONFIRMED attempt and it must be STRIPE —
  // a double-paid payment (Stripe + on-chain, or two PaymentIntents)
  // has no single-refund path; refunding one leg and flipping the
  // payment would strand the other settlement. Reconcile manually.
  const confirmed = attempts.filter((a) => a.status === "CONFIRMED");
  if (
    confirmed.length !== 1 ||
    confirmed[0]!.provider !== "STRIPE" ||
    confirmed.some((a) => a.provider !== "STRIPE")
  ) {
    return fail(
      "INVALID_STATE",
      "stripe refund requires exactly one CONFIRMED Stripe settlement — mixed/multi-settled payments need manual reconciliation",
    );
  }
  const stripeAttempt = confirmed[0]!.providerReference
    ? confirmed[0]!
    : undefined;
  if (!stripeAttempt?.providerReference) {
    return fail(
      "INVALID_STATE",
      "no CONFIRMED STRIPE attempt with a provider reference — cannot auto-refund",
    );
  }
  // L-12: the reference must be a PaymentIntent id — a Checkout
  // Session id would make every refund fail after the INITIATED row.
  if (!stripeAttempt.providerReference.startsWith("pi_")) {
    return fail(
      "INVALID_STATE",
      "stripe attempt providerReference is not a PaymentIntent id (pi_…) — reconcile before refunding",
    );
  }
  // C2: manual intents reserve refund capacity — a full Stripe refund
  // on top of them would exceed the payment amount.
  let count: number;
  try {
    count = (await refundUsage(db, payment.id)).count;
  } catch (e) {
    return fail(
      "PROVIDER_ERROR",
      `corrupt amount data: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (count > 0) {
    return fail(
      "INVALID_STATE",
      "manual refund intents exist — use the intent path or complete them first",
    );
  }
  const operator = normalizeOperator(input.operator);
  const idempotencyKey = `refund:${payment.id}`;
  // M-6: unique initiation id pairs INITIATED ↔ terminal rows — the
  // in-flight lock matches by id, not by ms-ordering.
  const initiationId = crypto.randomUUID();
  // H2: initiated audit row BEFORE the external effect — an unaudited
  // refund attempt requires the audit store itself to be down.
  const initiated = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: payment.id,
    operator,
    principalId: operator,
    evidence: {
      kind: "STRIPE_REFUND_INITIATED",
      initiationId,
      idempotencyKey,
      attemptId: stripeAttempt.id,
      paymentIntent: stripeAttempt.providerReference,
      reason: input.reason ?? null,
    },
  });
  if (!initiated.ok) return initiated;
  let refund: { id: string; status?: string };
  try {
    refund = await withTimeout(
      stripe.refunds.create(
        {
          payment_intent: stripeAttempt.providerReference,
          ...(stripeReason(input.reason) !== undefined
            ? { reason: stripeReason(input.reason) }
            : {}),
          metadata: { paymentId: payment.id },
        },
        { idempotencyKey },
      ),
      PROVIDER_TIMEOUT_MS,
    );
  } catch (e) {
    // M-6: a definite 4xx rejection ends the attempt (FAILED releases
    // the lock); a timeout/5xx is ambiguous — Stripe may still have
    // processed it, so UNCERTAIN keeps the manual path locked.
    const definite = isDefiniteProviderRejection(e);
    await auditStripeOutcome(db, { paymentId: payment.id, operator }, {
      kind: definite ? "STRIPE_REFUND_FAILED" : "STRIPE_REFUND_UNCERTAIN",
      initiationId,
      idempotencyKey,
      attemptId: stripeAttempt.id,
      stage: "provider_call",
      error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
    });
    return fail(
      "PROVIDER_ERROR",
      `stripe refund failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // Provider must report the refund actually succeeded — a pending or
  // failed refund is not a confirmation (H3 + nit: explicit succeed).
  if (refund.status !== "succeeded") {
    // M-6: failed/canceled is a definite terminal state; pending (or
    // anything else) stays UNCERTAIN — the refund id may still settle.
    const definite =
      refund.status === "failed" || refund.status === "canceled";
    await auditStripeOutcome(db, { paymentId: payment.id, operator }, {
      kind: definite ? "STRIPE_REFUND_FAILED" : "STRIPE_REFUND_UNCERTAIN",
      initiationId,
      idempotencyKey,
      attemptId: stripeAttempt.id,
      stage: "status",
      stripeRefundId: refund.id,
      status: refund.status ?? "unknown",
    });
    return fail(
      "PROVIDER_ERROR",
      `stripe refund ${refund.id} reports status ${refund.status ?? "unknown"}, not succeeded`,
    );
  }
  // N1 + N4-2: flip FIRST — the refund already happened at Stripe; a
  // failure here must not strand the payment in CONFIRMED revenue nor
  // 500 after money moved. A thrown store error is reported, not
  // propagated — the reconcile path finds the needsReconcile flag.
  let flipped: unknown = null;
  let flipThrew = false;
  try {
    flipped = await db.payments.payments.applyStatus(
      payment.id,
      "CONFIRMED",
      "REFUNDED",
      Date.now(),
    );
  } catch {
    flipThrew = true;
  }
  const completionEvidence = {
    stripeRefundId: refund.id,
    attemptId: stripeAttempt.id,
    initiationId,
    idempotencyKey,
    status: refund.status,
    reason: input.reason ?? null,
    // N1: caller evidence is bounded separately — a ~4 KB caller
    // payload wrapped here must not overflow the audit row.
    details: boundedEvidence(input.evidence, 1024),
    paymentFlip: flipped !== null,
    ...(flipThrew ? { needsReconcile: true } : {}),
    kind: "STRIPE_REFUND",
  };
  const audit = await recordPostEffectAudit(
    db,
    {
      action: "REFUND",
      subjectType: "payment",
      subjectId: payment.id,
      operator,
      principalId: operator,
      evidence: completionEvidence,
    },
    {
      kind: "STRIPE_REFUND",
      initiationId,
      stripeRefundId: refund.id,
      paymentFlip: flipped !== null,
    },
  );
  // M-2: the refund already landed — never return failure for money
  // that moved; report the audit gap explicitly instead.
  return ok({
    stripeRefundId: refund.id,
    paymentId: payment.id,
    paymentFlip: flipped !== null,
    auditRecorded: audit.ok,
    ...(flipThrew ? { needsReconcile: true } : {}),
  });
}
