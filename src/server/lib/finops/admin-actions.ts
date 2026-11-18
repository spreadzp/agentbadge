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

import {
  ADMIN_ACTIONS,
  type AdminActionRow,
  type Database,
  type PaymentAttemptRow,
} from "@agentbadge/database";

import {
  MAX_ID_FIELD,
  checkTextField,
  guardAction,
  isMeaningfulEvidence,
  normalizeOperator,
} from "./guards";
import { type FinOpsResult, fail, ok } from "./types";

// Server-side vocabulary — the published store const plus the action
// added in 226-6 (DETECT_EXCEPTIONS). The Set dedupes when the
// package const catches up.
const KNOWN_ACTIONS = new Set<string>([
  ...ADMIN_ACTIONS,
  "DETECT_EXCEPTIONS",
]);

/** External-review subjects — closed vocabulary (M1/226-6). */
const EXTERNAL_SUBJECT_TYPES = new Set([
  "payment",
  "attempt",
  "agreement",
  "exception",
  "order",
]);

/** Unique action id — actions are events, not dedupe keys. */
const nextActionId = (): string =>
  `aa_${Date.now()}_${crypto.randomUUID()}`;

export interface RecordAdminActionInput {
  action: string; // AdminActionKind
  subjectType: string;
  subjectId: string;
  operator: string;
  evidence?: unknown;
}

/** Audit append — guards operator + evidence, then writes the row.
 *  `action` must come from the ADMIN_ACTIONS vocabulary; the operator
 *  label is stored in its normalized form (H5). */
export async function recordAdminAction(
  db: Database,
  input: RecordAdminActionInput,
): Promise<FinOpsResult<AdminActionRow>> {
  if (!KNOWN_ACTIONS.has(input.action)) {
    return fail("BAD_INPUT", `unknown admin action: ${input.action}`);
  }
  const cap =
    checkTextField(input.subjectType, "subjectType", MAX_ID_FIELD) ??
    checkTextField(input.subjectId, "subjectId", MAX_ID_FIELD);
  if (cap) return cap;
  const guard = guardAction(input.operator, input.evidence);
  if (guard) return guard;
  const row = await db.finops.adminActions.append({
    id: nextActionId(),
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    operator: normalizeOperator(input.operator),
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
  // H1: meaningful evidence is required — "reviewed" without proof is
  // an audit gap; empty objects/blank strings do not count.
  if (!isMeaningfulEvidence(evidence)) {
    return fail(
      "BAD_INPUT",
      "markExternalReviewed requires meaningful evidence",
    );
  }
  const subjType =
    typeof subjectType === "string" ? subjectType.trim() : "";
  const subjId = typeof subjectId === "string" ? subjectId.trim() : "";
  if (subjType === "" || subjId === "") {
    return fail("BAD_INPUT", "subjectType and subjectId are required");
  }
  if (!EXTERNAL_SUBJECT_TYPES.has(subjType)) {
    return fail(
      "BAD_INPUT",
      `subjectType must be one of ${[...EXTERNAL_SUBJECT_TYPES].join("|")}`,
    );
  }
  // N19: a "reviewed" marker on a non-existent payment is a lying
  // audit row — payment subjects must resolve.
  if (subjType === "payment") {
    const missing = await requirePayment(db, subjId);
    if (missing) return missing;
  }
  return recordAdminAction(db, {
    action: "MARK_EXTERNAL_REVIEWED",
    subjectType: subjType,
    subjectId: subjId,
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
