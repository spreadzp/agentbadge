/**
 * EPIC-226 / SLICE-226-6 — refund-intent completion behind verified
 * on-chain evidence (D-226-4 invariant: no fabricated confirmation).
 *
 * Order: guards → txHash normalize → replay guard (one tx binds at
 * most one intent, C3) → payment state + cumulative cap re-check (C2)
 * → chain read via the injected `verifyTx` → fact cross-checks (H4:
 * payer ≠ payee, reported asset == expected currency) → guarded
 * transition → payment REFUNDED flip → audit recording the real
 * outcome. The domain never trusts a bare hash.
 */

import type {
  Database,
  RefundIntentRow,
} from "@agentbadge/database";

import { recordAdminAction } from "./admin-actions";
import {
  decimalLte,
  normalizeOperator,
  normalizeTxHash,
  requireOperator,
  sumDecimals,
} from "./guards";
import { withPaymentLock } from "./payment-mutex";
import {
  type FinOpsResult,
  type RefundTxCheck,
  type VerifyRefundTx,
  fail,
  ok,
} from "./types";

export interface CompleteRefundIntentInput {
  intentId: string;
  txHash: string;
  /** Completing operator label — audit attribution. */
  operator: string;
}

export async function completeRefundIntent(
  db: Database,
  input: CompleteRefundIntentInput,
  verifyTx: VerifyRefundTx,
): Promise<FinOpsResult<RefundIntentRow>> {
  // N8: serialize refund mutations per payment — the cap and the
  // replay guard are check-then-write and must not interleave.
  // The lock key is resolved cheaply before the critical section.
  const intent = await db.finops.refundIntents.getById(input.intentId);
  const key = intent?.paymentId ?? input.intentId;
  return withPaymentLock(key, () =>
    completeRefundIntentInner(db, input, verifyTx, intent ?? undefined),
  );
}

/** N12: rejected completions are security events — bound + audit. */
async function auditRejectedCompletion(
  db: Database,
  input: CompleteRefundIntentInput,
  intent: RefundIntentRow | undefined,
  txHash: string | null,
  reason: string,
): Promise<void> {
  if (!intent) return;
  await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: intent.paymentId,
    operator: normalizeOperator(input.operator),
    evidence: {
      kind: "INTENT_COMPLETE_REJECTED",
      intentId: input.intentId,
      txHash: txHash ?? "invalid",
      reason: reason.slice(0, 200),
    },
  });
}

async function completeRefundIntentInner(
  db: Database,
  input: CompleteRefundIntentInput,
  verifyTx: VerifyRefundTx,
  prefetchedIntent?: RefundIntentRow,
): Promise<FinOpsResult<RefundIntentRow>> {
  const op = requireOperator(input.operator);
  if (op) return op as FinOpsResult<never>;
  const txHash =
    typeof input.txHash === "string"
      ? normalizeTxHash(input.txHash)
      : null;
  if (!txHash) {
    return fail(
      "BAD_INPUT",
      "txHash must be a 0x-prefixed 64-hex transaction hash",
    );
  }
  const intent = prefetchedIntent
    ? prefetchedIntent
    : await db.finops.refundIntents.getById(input.intentId);
  if (!intent) {
    return fail("NOT_FOUND", `refund intent not found: ${input.intentId}`);
  }
  if (intent.status !== "OPEN") {
    return fail(
      "INVALID_STATE",
      `refund intent is ${intent.status}, not OPEN`,
    );
  }
  // C3: replay guard — one real tx binds at most one intent. The
  // store-level unique index is the race backstop; this is the check.
  const completed = await db.finops.refundIntents.list({
    status: "COMPLETED",
  });
  const bound = completed.find((r) => r.txHash === txHash);
  if (bound) {
    await auditRejectedCompletion(
      db, input, intent, txHash, `replay — bound to ${bound.id}`,
    );
    return fail(
      "TX_REUSED",
      `txHash already bound to refund intent ${bound.id} — replay rejected`,
    );
  }
  // C2: re-check payment state + cumulative refunds at completion —
  // the payment may have been refunded through another path (Stripe)
  // or another intent while this one was open.
  const payment = await db.payments.payments.getById(intent.paymentId);
  if (!payment) {
    return fail("NOT_FOUND", `payment not found: ${intent.paymentId}`);
  }
  if (payment.status !== "CONFIRMED") {
    return fail(
      "INVALID_STATE",
      `payment is ${payment.status}, refund completion requires CONFIRMED`,
    );
  }
  const used = sumDecimals(
    completed
      .filter((r) => r.paymentId === payment.id)
      .map((r) => r.amount),
  );
  const total = sumDecimals([used, intent.amount]);
  if (!decimalLte(total, payment.amount)) {
    return fail(
      "INVALID_STATE",
      `cumulative refunds ${total} would exceed payment amount ${payment.amount} (already completed ${used})`,
    );
  }
  const expectedCurrency = (
    intent.currency ??
    payment.currency ??
    "USDC"
  ).toUpperCase();
  // N11: the RPC call can throw — a verifier outage is PROVIDER_ERROR,
  // not a 500. `notBeforeMs` gets a 1s tolerance: block timestamps are
  // second-granular, so a tx mined in the same second as intent
  // creation must not be rejected permanently.
  let check: RefundTxCheck;
  try {
    check = await verifyTx(txHash, {
      payee: intent.payee,
      amount: intent.amount,
      currency: expectedCurrency,
      notBeforeMs: intent.createdAtMs - 1000,
    });
  } catch (e) {
    return fail(
      "PROVIDER_ERROR",
      `verifier call failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!check || check.verified !== true) {
    const reason =
      check && typeof check.reason === "string"
        ? check.reason
        : "on-chain read did not confirm the refund tx — not completing";
    await auditRejectedCompletion(db, input, intent, txHash, reason);
    return fail("TX_UNVERIFIED", reason);
  }
  // H4: cross-check verifier-reported facts — `verified: true` alone
  // is not enough to trust the adapter bound the right tx.
  if (typeof check.payer === "string" && check.payer.trim() !== "") {
    const payer = check.payer.trim().toLowerCase();
    if (payer === intent.payee.toLowerCase()) {
      await auditRejectedCompletion(
        db, input, intent, txHash, "sender equals payee — self-transfer",
      );
      return fail(
        "TX_UNVERIFIED",
        "refund tx sender equals the payee — self-transfer is not a payout",
      );
    }
  }
  if (typeof check.asset === "string" && check.asset.trim() !== "") {
    if (
      check.asset.trim().toUpperCase() !== expectedCurrency.toUpperCase()
    ) {
      await auditRejectedCompletion(
        db, input, intent, txHash,
        `asset ${check.asset} ≠ ${expectedCurrency}`,
      );
      return fail(
        "TX_UNVERIFIED",
        `verifier reports asset ${check.asset}, expected ${expectedCurrency}`,
      );
    }
  }
  const operator = normalizeOperator(input.operator);
  const done = await db.finops.refundIntents.complete(
    intent.id,
    txHash,
    operator,
    Date.now(),
  );
  if (!done) {
    return fail(
      "INVALID_STATE",
      "refund intent transitioned or txHash was bound concurrently — not completing",
    );
  }
  // N10: cumulative flip — the payment leaves revenue when TOTAL
  // completed refunds reach the payment amount, not when this one
  // intent alone covers it (60+40 on 100 must flip).
  let flipApplied = false;
  const current = await db.payments.payments.getById(intent.paymentId);
  if (
    current &&
    current.status === "CONFIRMED" &&
    decimalLte(current.amount, total)
  ) {
    flipApplied =
      (await db.payments.payments.applyStatus(
        current.id,
        "CONFIRMED",
        "REFUNDED",
        Date.now(),
      )) !== null;
  }
  const audit = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: intent.paymentId,
    operator,
    evidence: {
      intentId: intent.id,
      txHash,
      kind: "INTENT_COMPLETED",
      network: check.network ?? null,
      payer: check.payer ?? null,
      confirmations: check.confirmations ?? null,
      paymentFlip: flipApplied,
    },
  });
  if (!audit.ok) return audit;
  return ok(done);
}
