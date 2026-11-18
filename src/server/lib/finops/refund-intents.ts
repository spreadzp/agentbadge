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
import { withPaymentLock } from "./payment-mutex";
import { type FinOpsResult, fail, ok } from "./types";

const nextIntentId = (paymentId: string): string =>
  `ri_${paymentId}_${crypto.randomUUID()}`;

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
 *  non-cancelled intent row (OPEN reserves, COMPLETED spent)
 *  counts (C2). */
export async function refundUsage(
  db: Database,
  paymentId: string,
): Promise<{ usage: string; count: number }> {
  const intents = (await db.finops.refundIntents.listByPayment(
    paymentId,
  )).filter((i) => i.status !== "CANCELLED");
  return { usage: sumDecimals(intents.map((i) => i.amount)), count: intents.length };
}

/** Terminal kinds that close a Stripe refund attempt in the trail. */
const STRIPE_TERMINAL_KINDS = new Set([
  "STRIPE_REFUND",
  "STRIPE_REFUND_FAILED",
]);

/**
 * N4: a STRIPE_REFUND_INITIATED row without a matching terminal row
 * means a provider refund may be in flight (pending, crashed, or the
 * response was lost). The payment's refund capacity stays locked
 * until a terminal row exists — the manual intent path must not
 * double-pay meanwhile.
 */
async function stripeRefundInFlight(
  db: Database,
  paymentId: string,
): Promise<boolean> {
  const rows = await db.finops.adminActions.listBySubject(
    "payment",
    paymentId,
  );
  let initiated = false;
  for (const r of rows) {
    const kind =
      r.evidence !== null &&
      typeof r.evidence === "object" &&
      !Array.isArray(r.evidence)
        ? (r.evidence as Record<string, unknown>).kind
        : undefined;
    if (kind === "STRIPE_REFUND_INITIATED") initiated = true;
    else if (typeof kind === "string" && STRIPE_TERMINAL_KINDS.has(kind)) {
      initiated = false;
    }
  }
  return initiated;
}

/** Open a refund intent on a CONFIRMED payment + audit row. */
export async function createRefundIntent(
  db: Database,
  input: CreateRefundIntentInput,
): Promise<FinOpsResult<RefundIntentRow>> {
  return withPaymentLock(input.paymentId, () =>
    createRefundIntentInner(db, input),
  );
}

async function createRefundIntentInner(
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
  // N4: the intent path is the ON-CHAIN refund arm — a card-paid
  // Stripe payment would get a second full refund to an EVM wallet.
  const attempts = await db.payments.attempts.listByPayment(payment.id);
  const confirmedAttempt = attempts.find((a) => a.status === "CONFIRMED");
  if (confirmedAttempt?.provider === "STRIPE") {
    return fail(
      "INVALID_STATE",
      "payment settled via Stripe — use the stripe refund mode, not a manual intent",
    );
  }
  // N4: an initiated Stripe refund without a terminal audit row may
  // still be moving money — the capacity stays locked.
  if (await stripeRefundInFlight(db, payment.id)) {
    return fail(
      "INVALID_STATE",
      "a Stripe refund is in flight for this payment — resolve it before opening an intent",
    );
  }
  // N11: the intent's asset must match the payment's — a USDC payment
  // cannot be refunded in another asset on operator say-so.
  const currency = (input.currency ?? payment.currency ?? "USDC")
    .trim()
    .toUpperCase();
  const paymentCurrency = (payment.currency ?? "USDC").toUpperCase();
  if (currency !== paymentCurrency) {
    return fail(
      "BAD_INPUT",
      `intent currency ${currency} must match payment currency ${paymentCurrency}`,
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
    currency,
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
