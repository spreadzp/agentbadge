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
import { openStripeInitiations } from "./refund-audit";
import {
  LockAcquireTimeoutError,
  withLock,
} from "./payment-mutex";
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

/** Providers that settle on-chain — the intent path refunds these. */
const ONCHAIN_PROVIDERS = new Set(["DIRECT_USDC", "X402", "HEDERA"]);

async function stripeRefundInFlight(
  db: Database,
  paymentId: string,
): Promise<boolean> {
  return (await openStripeInitiations(db, paymentId)).size > 0;
}

/** Open a refund intent on a CONFIRMED payment + audit row. */
export async function createRefundIntent(
  db: Database,
  input: CreateRefundIntentInput,
): Promise<FinOpsResult<RefundIntentRow>> {
  try {
    return await withLock("pay", input.paymentId, () =>
      createRefundIntentInner(db, input),
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
  // M-5/N4: the intent path is the ON-CHAIN refund arm — every
  // CONFIRMED attempt must be an on-chain settlement and at least one
  // must exist. A deny-list on the first attempt misses mixed/double-
  // paid states: a card-paid payment must never get a manual EVM
  // refund on top of it.
  const attempts = await db.payments.attempts.listByPayment(payment.id);
  const confirmed = attempts.filter((a) => a.status === "CONFIRMED");
  const settled = confirmed.find((a) => ONCHAIN_PROVIDERS.has(a.provider));
  if (
    confirmed.length === 0 ||
    !settled ||
    confirmed.some((a) => !ONCHAIN_PROVIDERS.has(a.provider))
  ) {
    return fail(
      "INVALID_STATE",
      "refund intents require a CONFIRMED on-chain-only settlement — Stripe-settled payments use the stripe refund mode",
    );
  }
  // N4: an initiated Stripe refund without a paired terminal audit
  // row may still be moving money — the capacity stays locked.
  if (await stripeRefundInFlight(db, payment.id)) {
    return fail(
      "INVALID_STATE",
      "a Stripe refund is in flight for this payment — resolve it before opening an intent",
    );
  }
  // L4-6: two on-chain settlements in DIFFERENT assets have no single
  // correct denomination — the sum is meaningless and must not be
  // silently coerced to "USDC"; reconcile manually. Same for an
  // attempt that never recorded its currency.
  const onChainCurrencies = new Set(
    confirmed.map((a) => (a.currency ?? "").trim().toUpperCase()),
  );
  if (onChainCurrencies.size !== 1) {
    return fail(
      "INVALID_STATE",
      "on-chain settlements record missing or mixed currencies — refund needs manual reconciliation",
    );
  }
  // M-1/N11: the intent's asset is the settled attempt's currency —
  // `Payment.currency` is the denomination ("USD"), not the on-chain
  // asset the verifier must see moved ("USDC"; USD↔USDC priced 1:1).
  const asset = settled.currency!.trim().toUpperCase();
  const currency = (input.currency ?? asset).trim().toUpperCase();
  if (currency !== asset) {
    return fail(
      "BAD_INPUT",
      `intent currency ${currency} must match the settled asset ${asset}`,
    );
  }
  // Cap against what actually settled on-chain (≤ the payment label
  // amount in the normal case).
  const capBase = decimalLte(settled.amount, payment.amount)
    ? settled.amount
    : payment.amount;
  if (!decimalLte(input.amount, capBase)) {
    return fail(
      "BAD_INPUT",
      `refund amount ${input.amount} exceeds settled amount ${capBase}`,
    );
  }
  // C2: cumulative cap — prior intents (OPEN reserves + COMPLETED)
  // plus the new amount can never exceed the settled amount.
  let usage: string;
  let total: string;
  try {
    usage = (await refundUsage(db, payment.id)).usage;
    total = sumDecimals([usage, input.amount]);
  } catch (e) {
    return fail(
      "PROVIDER_ERROR",
      `corrupt amount data: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!decimalLte(total, capBase)) {
    return fail(
      "INVALID_STATE",
      `cumulative refunds ${total} would exceed settled amount ${capBase} (already reserved ${usage})`,
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
