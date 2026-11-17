/**
 * EPIC-226 / SLICE-226-2 — audited admin actions (D-226-3).
 *
 * `recordAdminAction` is the only AdminAction write path in the
 * domain: `operator` is mandatory and evidence is capped at 4 KB —
 * every manual action produces an append-only audit row before or
 * with its effect. Manual review/retry/mark-external flows never
 * fabricate a confirmation — they are attribution markers plus the
 * real effect (retry returns the re-verifiable attempts).
 */

import type {
  AdminActionRow,
  Database,
  PaymentAttemptRow,
} from "@agentbadge/database";

import { guardAction } from "./guards";
import { type FinOpsResult, fail, ok } from "./types";

let actionSeq = 0;

/** Unique action id — actions are events, not dedupe keys. */
const nextActionId = (): string =>
  `aa_${Date.now()}_${(actionSeq += 1)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

export interface RecordAdminActionInput {
  action: string; // AdminActionKind
  subjectType: string;
  subjectId: string;
  operator: string;
  evidence?: unknown;
}

/** Audit append — guards operator + evidence, then writes the row. */
export async function recordAdminAction(
  db: Database,
  input: RecordAdminActionInput,
): Promise<FinOpsResult<AdminActionRow>> {
  const guard = guardAction(input.operator, input.evidence);
  if (guard) return guard;
  const row = await db.finops.adminActions.append({
    id: nextActionId(),
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    operator: input.operator.trim(),
    evidence: (input.evidence ?? null) as AdminActionRow["evidence"],
    createdAtMs: Date.now(),
  });
  if (!row) {
    return fail("PROVIDER_ERROR", "admin action insert deduped on id");
  }
  return ok(row);
}

/** Payment must exist for payment-scoped actions — audit lies otherwise. */
async function requirePayment(
  db: Database,
  paymentId: string,
): Promise<FinOpsResult<never> | null> {
  const p = await db.payments.payments.getById(paymentId);
  if (!p) return fail("NOT_FOUND", `payment not found: ${paymentId}`);
  return null;
}

/**
 * REVIEW — human looked at the payment. Marker action; no state
 * change (review outcome travels via exceptions/refunds).
 */
export async function reviewPayment(
  db: Database,
  paymentId: string,
  operator: string,
  evidence?: unknown,
): Promise<FinOpsResult<AdminActionRow>> {
  const missing = await requirePayment(db, paymentId);
  if (missing) return missing;
  return recordAdminAction(db, {
    action: "REVIEW",
    subjectType: "payment",
    subjectId: paymentId,
    operator,
    evidence,
  });
}

export interface RetryVerifyResult {
  action: AdminActionRow;
  /** Non-terminal attempts eligible for a re-verification pass. */
  retryableAttempts: PaymentAttemptRow[];
}

/**
 * RETRY_VERIFY — audit the request and return the open attempts the
 * ops layer may re-verify. The actual chain re-scan lives in the
 * monitor path (EPIC-222), not here — this slice records intent and
 * hands back the candidates, never fabricating a confirmation.
 */
export async function retryVerification(
  db: Database,
  paymentId: string,
  operator: string,
  evidence?: unknown,
): Promise<FinOpsResult<RetryVerifyResult>> {
  const missing = await requirePayment(db, paymentId);
  if (missing) return missing;
  const action = await recordAdminAction(db, {
    action: "RETRY_VERIFY",
    subjectType: "payment",
    subjectId: paymentId,
    operator,
    evidence,
  });
  if (!action.ok) return action;
  const attempts = await db.payments.attempts.listByPayment(paymentId);
  const retryableAttempts = attempts.filter((a) =>
    ["CREATED", "PENDING", "PROCESSING"].includes(a.status),
  );
  return ok({ action: action.value, retryableAttempts });
}

/**
 * MARK_EXTERNAL_REVIEWED — off-chain/external payment (e.g. an
 * agreement-side record) marked reviewed. Evidence is REQUIRED —
 * "reviewed" without proof is an audit gap.
 */
export async function markExternalReviewed(
  db: Database,
  subjectType: string,
  subjectId: string,
  operator: string,
  evidence: unknown,
): Promise<FinOpsResult<AdminActionRow>> {
  if (
    evidence === undefined ||
    evidence === null ||
    (typeof evidence === "object" &&
      !Array.isArray(evidence) &&
      Object.keys(evidence as object).length === 0)
  ) {
    return fail(
      "BAD_INPUT",
      "markExternalReviewed requires non-empty evidence",
    );
  }
  if (
    typeof subjectType !== "string" ||
    subjectType.trim() === "" ||
    typeof subjectId !== "string" ||
    subjectId.trim() === ""
  ) {
    return fail("BAD_INPUT", "subjectType and subjectId are required");
  }
  return recordAdminAction(db, {
    action: "MARK_EXTERNAL_REVIEWED",
    subjectType: subjectType.trim(),
    subjectId: subjectId.trim(),
    operator,
    evidence,
  });
}

/** Newest-first audit listing for the admin console. */
export async function listAdminActions(
  db: Database,
  opts?: {
    action?: string;
    subjectType?: string;
    operator?: string;
    sinceMs?: number;
    limit?: number;
  },
): Promise<AdminActionRow[]> {
  return db.finops.adminActions.list(opts);
}
