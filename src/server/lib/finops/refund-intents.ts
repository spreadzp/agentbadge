/**
 * EPIC-226 / SLICE-226-2 — refund intents (D-226-4);
 * SLICE-226-6 hardening (C1/C2): every caller-controlled field is
 * capped BEFORE any effect, and the cumulative refund total (OPEN
 * reserves + COMPLETED intents) can never exceed the payment amount.
 *
 * Manual on-chain path: `createRefundIntent` opens an intent; ops
 * sends the payout tx off-band; `completeRefundIntent` (in
 * `refund-completion.ts`) finishes it ONLY after an injected
 * `verifyTx` confirms the real txHash pays the intent's payee ≥ the
 * intent's amount. No fabricated confirmation.
 * (The Stripe auto path lives in `stripe-refunds.ts`.)
 */

import type {
  Database,
  RefundIntentRow,
} from "@agentbadge/database";

import { recordAdminAction } from "./admin-actions";
import {
  MAX_CURRENCY_LEN,
  MAX_PAYEE_LEN,
  MAX_TEXT_FIELD,
  checkEvidence,
  checkTextField,
  decimalGt,
  decimalLte,
  isDecimalString,
  isEvmAddress,
  normalizeOperator,
  requireOperator,
  sumDecimals,
} from "./guards";
import { type FinOpsResult, fail, ok } from "./types";

let intentSeq = 0;
const nextIntentId = (paymentId: string): string =>
  `ri_${paymentId}_${(intentSeq += 1)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

export interface CreateRefundIntentInput {
  paymentId: string;
  /** Destination wallet for the manual on-chain payout. */
  payee: string;
  /** Decimal string — >0 and ≤ payment.amount minus existing intents. */
  amount: string;
  currency?: string;
  reason: string;
  operator: string;
  evidence?: unknown;
}

/** Total refund exposure already reserved on the payment — every
 *  intent row (OPEN reserves, COMPLETED spent) counts (C2). */
export async function refundUsage(
  db: Database,
  paymentId: string,
): Promise<{ usage: string; count: number }> {
  const intents = await db.finops.refundIntents.listByPayment(paymentId);
  return { usage: sumDecimals(intents.map((i) => i.amount)), count: intents.length };
}

/** Open a refund intent on a CONFIRMED payment + audit row. */
export async function createRefundIntent(
  db: Database,
  input: CreateRefundIntentInput,
): Promise<FinOpsResult<RefundIntentRow>> {
  // --- all guards BEFORE the first effect (C1) ---------------------
  const op = requireOperator(input.operator);
  if (op) return op as FinOpsResult<never>;
  const ev = checkEvidence(input.evidence);
  if (ev) return ev as FinOpsResult<never>;
  const payee = typeof input.payee === "string" ? input.payee.trim() : "";
  if (payee === "") {
    return fail("BAD_INPUT", "payee wallet is required");
  }
  const reason =
    typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") {
    return fail("BAD_INPUT", "refund reason is required");
  }
  const cap =
    checkTextField(reason, "reason", MAX_TEXT_FIELD) ??
    checkTextField(payee, "payee", MAX_PAYEE_LEN) ??
    (input.currency !== undefined
      ? checkTextField(input.currency, "currency", MAX_CURRENCY_LEN)
      : null);
  if (cap) return cap;
  if (!isEvmAddress(payee)) {
    return fail("BAD_INPUT", "payee must be a 0x EVM address");
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
  // Amount beyond the payment is invalid input regardless of state.
  if (!decimalLte(input.amount, payment.amount)) {
    return fail(
      "BAD_INPUT",
      `refund amount ${input.amount} exceeds payment amount ${payment.amount}`,
    );
  }
  // C2: cumulative cap — prior intents (OPEN reserves + COMPLETED)
  // plus the new amount can never exceed the payment amount.
  const { usage } = await refundUsage(db, payment.id);
  const total = sumDecimals([usage, input.amount]);
  if (!decimalLte(total, payment.amount)) {
    return fail(
      "INVALID_STATE",
      `cumulative refunds ${total} would exceed payment amount ${payment.amount} (already reserved ${usage})`,
    );
  }
  const operator = normalizeOperator(input.operator);
  const intent = await db.finops.refundIntents.create({
    id: nextIntentId(input.paymentId),
    paymentId: input.paymentId,
    payee,
    amount: input.amount,
    currency: input.currency ?? payment.currency,
    reason,
    evidence: (input.evidence ?? null) as RefundIntentRow["evidence"],
    status: "OPEN",
    operator,
    createdAtMs: Date.now(),
  });
  if (!intent) {
    return fail("PROVIDER_ERROR", "refund intent insert deduped on id");
  }
  // Audit evidence is domain-built from bounded fields — it cannot
  // fail on size; a failure here means the store itself is down.
  const audit = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: input.paymentId,
    operator,
    evidence: {
      intentId: intent.id,
      amount: input.amount,
      payee,
      reason,
      kind: "INTENT_OPENED",
    },
  });
  if (!audit.ok) return audit;
  return ok(intent);
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
