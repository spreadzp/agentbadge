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
import { decimalLte, normalizeOperator } from "./guards";
import {
  type FinOpsResult,
  type RefundTxCheck,
  fail,
  ok,
} from "./types";
import type { RefundIntentRow } from "@agentbadge/database";

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
      principalId: input.operator,
      evidence,
    },
    minimal,
  );
  return r.ok;
}

/**
 * Terminal kinds that RELEASE the in-flight lock. M-6:
 * STRIPE_REFUND_UNCERTAIN deliberately does NOT — a timeout or
 * pending status may still be moving money, so capacity stays locked
 * until a definite success/rejection row exists.
 */
const STRIPE_LOCK_RELEASE_KINDS = new Set([
  "STRIPE_REFUND",
  "STRIPE_REFUND_FAILED",
]);

/**
 * N4 + M-6: STRIPE_REFUND_INITIATED rows without a matching
 * INITIATION-PAIRED terminal row mean a provider refund may be in
 * flight — the payment's refund capacity stays locked. Returns the
 * OPEN initiationIds so the resolution path can write a terminal
 * row against the exact initiation it closes. Rows are paired by
 * `initiationId` (not row order — ms-timestamp ties can invert in
 * Postgres), and only domain-written `action: "REFUND"` rows count:
 * caller evidence on REVIEW/RESOLVE rows cannot inject a forged
 * `kind` to spoof or clear the lock.
 */
export async function openStripeInitiations(
  db: Database,
  paymentId: string,
): Promise<Set<string>> {
  const rows = (
    await db.finops.adminActions.listBySubject("payment", paymentId)
  ).filter((r) => r.action === "REFUND");
  // N4-6: two passes — order must not matter (ms-timestamp ties are
  // unordered in Postgres). An initiation stays open iff no SAME-KEY
  // terminal row exists anywhere in the trail.
  const initiated = new Set<string>();
  const closed = new Set<string>();
  for (const r of rows) {
    const e =
      r.evidence !== null &&
      typeof r.evidence === "object" &&
      !Array.isArray(r.evidence)
        ? (r.evidence as Record<string, unknown>)
        : null;
    const kind = e?.kind;
    const key = typeof e?.initiationId === "string" ? e.initiationId : "legacy";
    if (kind === "STRIPE_REFUND_INITIATED") initiated.add(key);
    else if (typeof kind === "string" && STRIPE_LOCK_RELEASE_KINDS.has(kind)) {
      closed.add(key);
    }
  }
  for (const k of closed) initiated.delete(k);
  return initiated;
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
    principalId: input.operator,
    evidence: {
      kind: "INTENT_COMPLETE_REJECTED",
      intentId: input.intentId,
      txHash: txHash ?? "invalid",
      reason: reason.slice(0, 200),
    },
  });
}

/**
 * Verified-transition tail of completeRefundIntent — extracted for
 * the 300-line cap. Order: INTENT_COMPLETING row (pre-transition, L-6)
 * → guarded `complete()` → L4-2 abort marker on a lost race → N10
 * cumulative payment flip → post-effect INTENT_COMPLETED row.
 */
export async function finalizeRefundCompletion(
  db: Database,
  args: {
    intent: RefundIntentRow;
    txHash: string;
    operator: string;
    /** completed refunds total INCLUDING this intent (for the flip). */
    total: string;
    check: RefundTxCheck;
  },
): Promise<FinOpsResult<RefundIntentRow>> {
  const { intent, txHash, operator, total, check } = args;
  // L-6: audit the verified transition BEFORE it lands (mirrors the
  // Stripe INITIATED row) — if the process dies between `complete()`
  // and the completion row, the trail still shows a verified tx was
  // accepted for this intent, with the hash that binds it.
  const completing = await recordAdminAction(db, {
    action: "REFUND",
    subjectType: "payment",
    subjectId: intent.paymentId,
    operator,
    principalId: operator,
    evidence: {
      kind: "INTENT_COMPLETING",
      intentId: intent.id,
      txHash,
      amount: intent.amount,
    },
  });
  if (!completing.ok) return completing;
  let done: RefundIntentRow | null;
  try {
    done = await db.finops.refundIntents.complete(
      intent.id,
      txHash,
      operator,
      Date.now(),
    );
  } catch (e) {
    // N5-6/N6-4: a thrown transition leaves the outcome UNKNOWN —
    // the write may have COMMITTED, so this must not read as a
    // terminal "aborted". Pair the COMPLETING row with an explicit
    // UNCERTAIN marker (payment subject, needsReconcile) — ops must
    // verify the row's actual state before retrying.
    await recordPostEffectAudit(
      db,
      {
        action: "REFUND",
        subjectType: "payment",
        subjectId: intent.paymentId,
        operator,
        principalId: operator,
        evidence: {
          kind: "INTENT_COMPLETE_UNCERTAIN",
          intentId: intent.id,
          txHash,
          needsReconcile: true,
        },
      },
      { kind: "INTENT_COMPLETE_UNCERTAIN", intentId: intent.id },
    );
    return fail(
      "PROVIDER_ERROR",
      `refund transition threw — outcome uncertain, verify intent ${intent.id}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!done) {
    // L4-2/N5-6: the INTENT_COMPLETING row above would dangle without
    // a terminal companion — the abort marker goes under the PAYMENT
    // subject so the trail pairs completing → aborted on one subject.
    await recordPostEffectAudit(
      db,
      {
        action: "REFUND",
        subjectType: "payment",
        subjectId: intent.paymentId,
        operator,
        principalId: operator,
        evidence: {
          kind: "INTENT_COMPLETE_ABORTED",
          intentId: intent.id,
          txHash,
        },
      },
      { kind: "INTENT_COMPLETE_ABORTED", intentId: intent.id },
    );
    return fail(
      "INVALID_STATE",
      "refund intent transitioned or txHash was bound concurrently — not completing",
    );
  }
  // N10 + N4-2: cumulative flip — the payment leaves revenue when
  // TOTAL completed refunds reach the payment amount. A thrown store
  // error here must not 500 after the intent already COMPLETED —
  // record paymentFlip:false and let the reconcile path pick it up.
  let flipApplied = false;
  let flipThrew = false;
  try {
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
  } catch {
    flipThrew = true;
  }
  // M-2/L-3: the intent is COMPLETED — the audit row must degrade to
  // minimal evidence rather than strand the trail (and verifier-
  // supplied fields are sliced, they are not trusted-bounded).
  await recordPostEffectAudit(
    db,
    {
      action: "REFUND",
      subjectType: "payment",
      subjectId: intent.paymentId,
      operator,
      principalId: operator,
      evidence: {
        intentId: intent.id,
        txHash,
        kind: "INTENT_COMPLETED",
        network:
          typeof check.network === "string"
            ? check.network.slice(0, 128)
            : null,
        payer:
          typeof check.payer === "string"
            ? check.payer.slice(0, 128)
            : null,
        confirmations: check.confirmations ?? null,
        paymentFlip: flipApplied,
        ...(flipThrew ? { needsReconcile: true } : {}),
      },
    },
    { kind: "INTENT_COMPLETED", intentId: intent.id, txHash },
  );
  // The effect landed — report success even if the audit store was
  // down; the COMPLETING row above already carries the binding facts.
  return ok(done);
}
