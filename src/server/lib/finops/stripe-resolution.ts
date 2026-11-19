/**
 * EPIC-226 / SLICE-226-6 round-4 (N4-6) — manual resolution of a
 * STRIPE_REFUND_UNCERTAIN initiation.
 *
 * An uncertain terminal row (provider timeout/5xx/pending) does NOT
 * release the in-flight lock — money may still be moving — so
 * without this path the manual intent arm would stay locked
 * forever. The operator confirms out of band (Stripe dashboard /
 * API) whether the refund actually landed, then this writes the
 * paired terminal row against every OPEN initiationId:
 *   landed=true  → STRIPE_REFUND (releases the lock; flips payment)
 *   landed=false → STRIPE_REFUND_FAILED (releases, no flip)
 * It refuses when no open initiation exists — resolving a settled
 * trail would fabricate a refund that never initiated — and
 * requires meaningful evidence of what was verified.
 */

import type { Database } from "@agentbadge/database";

import { recordAdminAction } from "./admin-actions";
import {
  boundedEvidence,
  checkEvidence,
  isMeaningfulEvidence,
  normalizeOperator,
  requireOperator,
} from "./guards";
import {
  LockAcquireTimeoutError,
  withLock,
} from "./payment-mutex";
import { openStripeInitiations } from "./refund-audit";
import { type FinOpsResult, fail, ok } from "./types";

export interface ResolveStripeRefundInput {
  paymentId: string;
  operator: string;
  /** true — the operator confirmed the refund landed at Stripe. */
  landed: boolean;
  evidence?: unknown;
}

export interface ResolveStripeRefundResult {
  /** first open initiationId the resolution closed. */
  initiationId: string;
  paymentFlip: boolean;
  /** true when the flip threw — payment may still be CONFIRMED. */
  needsReconcile?: boolean;
}

export async function resolveStripeRefund(
  db: Database,
  input: ResolveStripeRefundInput,
): Promise<FinOpsResult<ResolveStripeRefundResult>> {
  try {
    return await withLock("pay", input.paymentId, () =>
      resolveStripeRefundInner(db, input),
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

async function resolveStripeRefundInner(
  db: Database,
  input: ResolveStripeRefundInput,
): Promise<FinOpsResult<ResolveStripeRefundResult>> {
  const op = requireOperator(input.operator);
  if (op) return op as FinOpsResult<never>;
  const operator = normalizeOperator(input.operator);
  // Resolving a refund is a consequential claim — the operator must
  // say what they verified, like review-external. N5-3: a SIZE check
  // alone is not enough — the row must carry meaningful evidence.
  const ev = checkEvidence(input.evidence);
  if (ev) return ev as FinOpsResult<never>;
  if (!isMeaningfulEvidence(input.evidence)) {
    return fail(
      "BAD_INPUT",
      "resolveStripeRefund requires meaningful evidence — say what was verified",
    );
  }
  const open = await openStripeInitiations(db, input.paymentId);
  if (open.size === 0) {
    return fail(
      "INVALID_STATE",
      `no open Stripe refund initiation on payment ${input.paymentId}`,
    );
  }
  // Every open initiation gets its own paired terminal row — legacy
  // trails can hold more than one (pre-initiationId "legacy" key).
  const kind = input.landed ? "STRIPE_REFUND" : "STRIPE_REFUND_FAILED";
  // N5-4: a thrown flip must be FLAGGED, not swallowed — the terminal
  // row closes the initiation either way, so the audit + result have
  // to carry that the payment may still sit in CONFIRMED revenue.
  let flipped: unknown = null;
  let flipThrew = false;
  if (input.landed) {
    try {
      flipped = await db.payments.payments.applyStatus(
        input.paymentId,
        "CONFIRMED",
        "REFUNDED",
        Date.now(),
      );
    } catch {
      flipThrew = true;
    }
  }
  let firstId = "";
  for (const initiationId of open) {
    const audit = await recordAdminAction(db, {
      action: "REFUND",
      subjectType: "payment",
      subjectId: input.paymentId,
      operator,
      evidence: {
        kind,
        initiationId,
        resolvedManually: true,
        paymentFlip: flipped !== null,
        ...(flipThrew ? { needsReconcile: true } : {}),
        details: boundedEvidence(input.evidence, 1024),
      },
    });
    if (!audit.ok) return audit;
    firstId ||= initiationId;
  }
  return ok({
    initiationId: firstId,
    paymentFlip: flipped !== null,
    ...(flipThrew ? { needsReconcile: true } : {}),
  });
}
