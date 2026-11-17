/**
 * EPIC-226 / SLICE-226-2 — refund intents (D-226-4).
 *
 * Two paths:
 * - Manual on-chain: `createRefundIntent` opens an intent; ops sends
 *   the payout tx off-band; `completeRefundIntent` finishes it ONLY
 *   after an injected `verifyTx` confirms the real txHash pays the
 *   intent's payee ≥ the intent's amount. No fabricated confirmation.
 * - Stripe: `stripeRefund` calls the provider API directly — the
 *   provider refund id is the evidence.
 *
 * Every path writes an AdminAction (audit before/with the effect) and
 * flips the payment to REFUNDED via the guarded transition when the
 * intent covers the full amount.
 */

import type {
  Database,
  RefundIntentRow,
} from "@agentbadge/database";

import { recordAdminAction } from "./admin-actions";
import {
  checkEvidence,
  decimalGt,
  decimalLte,
  isDecimalString,
  requireOperator,
} from "./guards";
import {
  type FinOpsResult,
  type StripeRefundClient,
  type VerifyRefundTx,
  fail,
  ok,
} from "./types";

let intentSeq = 0;
const nextIntentId = (paymentId: string): string =>
  `ri_${paymentId}_${(intentSeq += 1)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

export interface CreateRefundIntentInput {
  paymentId: string;
  /** Destination wallet for the manual on-chain payout. */
  payee: string;
  /** Decimal string — >0 and ≤ payment.amount. */
  amount: string;
  currency?: string;
  reason: string;
  operator: string;
  evidence?: unknown;
}

/** Open a refund intent on a CONFIRMED payment + audit row. */
export async function createRefundIntent(
  db: Database,
  input: CreateRefundIntentInput,
): Promise<FinOpsResult<RefundIntentRow>> {
  const op = requireOperator(input.operator);
  if (op) return op as FinOpsResult<never>;
  const ev = checkEvidence(input.evidence);
  if (ev) return ev as FinOpsResult<never>;
  if (typeof input.payee !== "string" || input.payee.trim() === "") {
    return fail("BAD_INPUT", "payee wallet is required");
  }
  if (typeof input.reason !== "string" || input.reason.trim() === "") {
    return fail("BAD_INPUT", "refund reason is required");
  }
  if (!isDecimalString(input.amount) || !decimalGt(input.amount, "0")) {
    return fail("BAD_INPUT", "amount must be a positive decimal");
  }
  const payment = await db.payments.payments.getById(input.paymentId);
  if (!payment) return fail("NOT_FOUND", `payment not found: ${input.paymentId}`);
  if (payment.status !== "CONFIRMED") {
    return fail(
      "INVALID_STATE",
      `refund intent requires CONFIRMED payment, got ${payment.status}`,
    );
  }
  if (!decimalLte(input.amount, payment.amount)) {
    return fail(
      "BAD_INPUT",
      `refund amount ${input.amount} exceeds payment amount ${payment.amount}`,
    );
  }
  const intent = await db.finops.refundIntents.create({
    id: nextIntentId(input.paymentId),
    paymentId: input.paymentId,
    payee: input.payee.trim(),
    amount: input.amount,
    currency: input.currency ?? payment.currency,
    reason: input.reason.trim(),
    evidence: (input.evidence ?? null) as RefundIntentRow["evidence"],
    status: "OPEN",
    operator: input.operator.trim(),
    createdAtMs: Date.now(),
  });
  if (!intent) {
    return fail("PROVIDER_ERROR", "refund intent insert deduped on id");
  }
  const audit = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: input.paymentId,
    operator: input.operator,
    evidence: {
      intentId: intent.id,
      amount: input.amount,
      payee: input.payee.trim(),
      reason: input.reason.trim(),
      kind: "INTENT_OPENED",
    },
  });
  if (!audit.ok) return audit;
  return ok(intent);
}

export interface CompleteRefundIntentInput {
  intentId: string;
  txHash: string;
  /** Completing operator label — audit attribution. */
  operator: string;
}

/**
 * Complete an intent ONLY behind verified on-chain evidence. The
 * injected `verifyTx` performs the chain read (tx exists, confirmed,
 * pays `payee` ≥ `amount`) — the domain never trusts a bare hash.
 */
export async function completeRefundIntent(
  db: Database,
  input: CompleteRefundIntentInput,
  verifyTx: VerifyRefundTx,
): Promise<FinOpsResult<RefundIntentRow>> {
  const op = requireOperator(input.operator);
  if (op) return op as FinOpsResult<never>;
  if (typeof input.txHash !== "string" || input.txHash.trim() === "") {
    return fail("BAD_INPUT", "txHash is required to complete a refund");
  }
  const intent = await db.finops.refundIntents.getById(input.intentId);
  if (!intent) {
    return fail("NOT_FOUND", `refund intent not found: ${input.intentId}`);
  }
  if (intent.status !== "OPEN") {
    return fail(
      "INVALID_STATE",
      `refund intent is ${intent.status}, not OPEN`,
    );
  }
  const check = await verifyTx(input.txHash.trim(), {
    payee: intent.payee,
    amount: intent.amount,
  });
  if (!check.verified) {
    return fail(
      "TX_UNVERIFIED",
      check.reason ??
      "on-chain read did not confirm the refund tx — not completing",
    );
  }
  const done = await db.finops.refundIntents.complete(
    intent.id,
    input.txHash.trim(),
    input.operator.trim(),
    Date.now(),
  );
  if (!done) {
    return fail(
      "INVALID_STATE",
      "refund intent transitioned concurrently — not completing",
    );
  }
  const audit = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: intent.paymentId,
    operator: input.operator,
    evidence: {
      intentId: intent.id,
      txHash: input.txHash.trim(),
      kind: "INTENT_COMPLETED",
      network: check.network ?? null,
      confirmations: check.confirmations ?? null,
    },
  });
  if (!audit.ok) return audit;
  // Full-amount intent → payment leaves revenue as REFUNDED (guarded).
  const payment = await db.payments.payments.getById(intent.paymentId);
  if (
    payment &&
    payment.status === "CONFIRMED" &&
    decimalLte(payment.amount, intent.amount)
  ) {
    await db.payments.payments.applyStatus(
      payment.id,
      "CONFIRMED",
      "REFUNDED",
      Date.now(),
    );
  }
  return ok(done);
}

export interface StripeRefundInput {
  paymentId: string;
  operator: string;
  reason?: string;
}

export interface StripeRefundResult {
  stripeRefundId: string;
  paymentId: string;
}

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
  const op = requireOperator(input.operator);
  if (op) return op as FinOpsResult<never>;
  const payment = await db.payments.payments.getById(input.paymentId);
  if (!payment) return fail("NOT_FOUND", `payment not found: ${input.paymentId}`);
  if (payment.status !== "CONFIRMED") {
    return fail(
      "INVALID_STATE",
      `stripe refund requires CONFIRMED payment, got ${payment.status}`,
    );
  }
  const attempts = await db.payments.attempts.listByPayment(payment.id);
  const stripeAttempt = attempts.find(
    (a) => a.provider === "STRIPE" && a.providerReference,
  );
  if (!stripeAttempt?.providerReference) {
    return fail(
      "INVALID_STATE",
      "no STRIPE attempt with a provider reference — cannot auto-refund",
    );
  }
  let refund: { id: string };
  try {
    refund = await stripe.refunds.create({
      payment_intent: stripeAttempt.providerReference,
      reason: input.reason ?? "requested_by_customer",
      metadata: { paymentId: payment.id },
    });
  } catch (e) {
    return fail(
      "PROVIDER_ERROR",
      `stripe refund failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const audit = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: payment.id,
    operator: input.operator,
    evidence: {
      stripeRefundId: refund.id,
      attemptId: stripeAttempt.id,
      kind: "STRIPE_REFUND",
    },
  });
  if (!audit.ok) return audit;
  await db.payments.payments.applyStatus(
    payment.id,
    "CONFIRMED",
    "REFUNDED",
    Date.now(),
  );
  return ok({ stripeRefundId: refund.id, paymentId: payment.id });
}

/** Newest-first intent listing; optional status/payment filters. */
export async function listRefundIntents(
  db: Database,
  opts?: { status?: string; paymentId?: string; limit?: number },
): Promise<RefundIntentRow[]> {
  if (opts?.paymentId !== undefined) {
    return db.finops.refundIntents.listByPayment(opts.paymentId);
  }
  return db.finops.refundIntents.list(opts);
}
