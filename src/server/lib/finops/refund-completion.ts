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

import {
  auditRejectedCompletion,
  finalizeRefundCompletion,
} from "./refund-audit";
import {
  decimalLte,
  normalizeOperator,
  normalizeTxHash,
  requireOperator,
  sumDecimals,
} from "./guards";
import {
  LockAcquireTimeoutError,
  withLock,
} from "./payment-mutex";
import { PROVIDER_TIMEOUT_MS, withTimeout } from "./provider-utils";
import {
  type FinOpsResult,
  type RefundTxCheck,
  type VerifyRefundTx,
  fail,
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
  // N8 + L-1: serialize refund mutations per payment — the cap and
  // the replay guard are check-then-write and must not interleave.
  // The lock key is resolved cheaply; the intent itself is RE-READ
  // inside the critical section so a queued second completion sees
  // the post-transition row, not a stale OPEN snapshot.
  const probe = await db.finops.refundIntents.getById(input.intentId);
  const key = probe?.paymentId ?? input.intentId;
  // L-4: also serialize on the normalized txHash — two intents on
  // DIFFERENT payments completed concurrently with one hash must not
  // both pass the replay check (the unique index is the last resort,
  // not the mechanism). Payment lock first, tx lock second — the only
  // nesting order used anywhere, so no deadlock.
  const txHash =
    typeof input.txHash === "string"
      ? normalizeTxHash(input.txHash)
      : null;
  try {
    return await withLock("pay", key, () =>
      txHash
        ? withLock("tx", txHash, () =>
            completeRefundIntentInner(db, input, verifyTx),
          )
        : completeRefundIntentInner(db, input, verifyTx),
    );
  } catch (e) {
    if (e instanceof LockAcquireTimeoutError) {
      return fail(
        "PROVIDER_ERROR",
        `mutation queue busy — retry refund completion ${input.intentId}`,
      );
    }
    throw e;
  }
}

async function completeRefundIntentInner(
  db: Database,
  input: CompleteRefundIntentInput,
  verifyTx: VerifyRefundTx,
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
  // L-1: fresh read inside the lock — never act on a pre-lock snapshot.
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
  // C3 + N4-4: replay guard — one real tx binds at most one intent.
  // The unique index is the race backstop; this is the check. The
  // reads sit inside the try — a corrupt intent row (repo `dec()`
  // throws) becomes PROVIDER_ERROR instead of a 500.
  let payment: NonNullable<
    Awaited<ReturnType<Database["payments"]["payments"]["getById"]>>
  >;
  let used: string;
  let total: string;
  try {
    const completed = await db.finops.refundIntents.list({
      status: "COMPLETED",
    });
    const bound = completed.find((r) => r.txHash === txHash);
    if (bound) {
      await auditRejectedCompletion(
        db, input, intent.paymentId, txHash, `replay — bound to ${bound.id}`,
      );
      return fail(
        "TX_REUSED",
        `txHash already bound to refund intent ${bound.id} — replay rejected`,
      );
    }
    // C2: re-check payment state + cumulative refunds at completion —
    // the payment may have been refunded through another path (Stripe)
    // or another intent while this one was open.
    const p = await db.payments.payments.getById(intent.paymentId);
    if (!p) {
      return fail("NOT_FOUND", `payment not found: ${intent.paymentId}`);
    }
    if (p.status !== "CONFIRMED") {
      return fail(
        "INVALID_STATE",
        `payment is ${p.status}, refund completion requires CONFIRMED`,
      );
    }
    payment = p;
    used = sumDecimals(
      completed
        .filter((r) => r.paymentId === payment.id)
        .map((r) => r.amount),
    );
    total = sumDecimals([used, intent.amount]);
  } catch (e) {
    return fail(
      "PROVIDER_ERROR",
      `corrupt refund data: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!decimalLte(total, payment.amount)) {
    return fail(
      "INVALID_STATE",
      `cumulative refunds ${total} would exceed payment amount ${payment.amount} (already completed ${used})`,
    );
  }
  // N5-2/N6-2: `||` not `??` — a blank-string currency row must fall
  // back, not reach the verifier as "" (asset cross-check would
  // silently compare "" === ""); the trim also closes the
  // whitespace-only bypass. A corrupt/blank currency falls back to
  // the payment denomination — which mismatches the on-chain asset,
  // so the check stays fail-closed.
  const expectedCurrency = (
    intent.currency?.trim() ||
    payment.currency?.trim() ||
    "USDC"
  ).toUpperCase();
  // N11 + L-2: the RPC call can throw or hang — a verifier outage is
  // PROVIDER_ERROR, not a 500, and a hung call must not pin the
  // payment lock. `notBeforeMs` gets a 1s tolerance: block timestamps
  // are second-granular, so a tx mined in the same second as intent
  // creation must not be rejected permanently.
  let check: RefundTxCheck;
  try {
    check = await withTimeout(
      verifyTx(txHash, {
        payee: intent.payee,
        amount: intent.amount,
        currency: expectedCurrency,
        notBeforeMs: intent.createdAtMs - 1000,
      }),
      PROVIDER_TIMEOUT_MS,
    );
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
    await auditRejectedCompletion(db, input, intent.paymentId, txHash, reason);
    return fail("TX_UNVERIFIED", reason);
  }
  // H4: cross-check verifier-reported facts — `verified: true` alone
  // is not enough to trust the adapter bound the right tx.
  if (typeof check.payer === "string" && check.payer.trim() !== "") {
    const payer = check.payer.trim().toLowerCase();
    if (payer === intent.payee.toLowerCase()) {
      await auditRejectedCompletion(
        db, input, intent.paymentId, txHash, "sender equals payee — self-transfer",
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
        db, input, intent.paymentId, txHash,
        `asset ${check.asset} ≠ ${expectedCurrency}`,
      );
      return fail(
        "TX_UNVERIFIED",
        `verifier reports asset ${check.asset}, expected ${expectedCurrency}`,
      );
    }
  }
  const operator = normalizeOperator(input.operator);
  return finalizeRefundCompletion(db, {
    intent,
    txHash,
    operator,
    total,
    check,
  });
}
