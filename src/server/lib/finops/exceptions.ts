/**
 * EPIC-226 / SLICE-226-2 — reconciliation exception lifecycle
 * (D-226-6): detect → OPEN (deterministic ids dedupe re-scans) →
 * resolve → AdminAction + RESOLVED.
 *
 * Two detection surfaces:
 * - `detectExceptions` — explicit candidates (sweeper/monitor output
 *   or the ops API later);
 * - `detectFromPaymentExceptions` — bridge from the EPIC-222
 *   `PaymentException` ops queue: OPEN payment exceptions map onto
 *   reconciliation types and get finops work-queue rows.
 */

import type {
  Database,
  ReconciliationExceptionRow,
} from "@agentbadge/database";

import {
  MAX_TEXT_FIELD,
  checkTextField,
  guardAction,
  normalizeOperator,
} from "./guards";
import { recordAdminAction } from "./admin-actions";
import {
  type DetectResult,
  type ExceptionCandidate,
  type FinOpsResult,
  fail,
  ok,
} from "./types";

/**
 * PaymentException.kind → ReconciliationExceptionType. Kinds that are
 * not reconciliation work (REFUND_REQUEST) map to null — skipped.
 */
const TYPE_BY_REASON: Record<string, string | null> = {
  UNDERPAID: "AMOUNT_MISMATCH",
  OVERPAID: "AMOUNT_MISMATCH",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
  WRONG_TOKEN: "AMOUNT_MISMATCH",
  WRONG_NETWORK: "AMOUNT_MISMATCH",
  RECONCILIATION_MISMATCH: "AMOUNT_MISMATCH",
  DUPLICATE_TRANSFER: "ORPHAN_TX",
  LATE_PAYMENT: "ORPHAN_TX",
  WRONG_RECIPIENT: "ORPHAN_TX",
  INSUFFICIENT_FINALITY: "MISSING_TX",
  REFUND_REQUEST: null,
};

const VALID_TYPES = new Set([
  "AMOUNT_MISMATCH",
  "MISSING_TX",
  "ORPHAN_TX",
  "REVERTED",
]);
const VALID_RESOLUTIONS = new Set([
  "MATCHED",
  "IGNORED",
  "MANUAL_ADJUSTED",
  "REFUNDED",
]);

let excSeq = 0;
const nextExceptionId = (type: string, subjectRef: string): string =>
  `rx_${type.toLowerCase()}_${subjectRef}_${(excSeq += 1)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

/**
 * Append detection candidates — deterministic `id` dedupes re-scans;
 * a missing id is generated from type+subjectRef+seq. Unknown types
 * are rejected.
 */
export async function detectExceptions(
  db: Database,
  candidates: readonly ExceptionCandidate[],
): Promise<FinOpsResult<DetectResult>> {
  const created: ReconciliationExceptionRow[] = [];
  const skipped: string[] = [];
  for (const c of candidates) {
    if (!VALID_TYPES.has(c.type)) {
      return fail("BAD_INPUT", `unknown exception type: ${c.type}`);
    }
    if (typeof c.subjectRef !== "string" || c.subjectRef.trim() === "") {
      return fail("BAD_INPUT", "exception subjectRef is required");
    }
    const id = c.id ?? nextExceptionId(c.type, c.subjectRef.trim());
    const row = await db.finops.exceptions.append({
      id,
      type: c.type,
      subjectRef: c.subjectRef.trim(),
      details: c.details ?? {},
      status: "OPEN",
      createdAtMs: Date.now(),
    });
    if (row) created.push(row);
    else skipped.push(id);
  }
  return ok({ created, skipped });
}

/**
 * Bridge EPIC-222 ops queue → finops work queue: OPEN
 * PaymentException rows become ReconciliationException rows keyed by
 * `rx-<paymentExceptionId>` so re-runs never double-create.
 */
export async function detectFromPaymentExceptions(
  db: Database,
  opts: { sinceMs?: number; limit?: number } = {},
): Promise<FinOpsResult<DetectResult>> {
  const open = await db.payments.exceptions.list({
    status: "OPEN",
    sinceMs: opts.sinceMs,
    // N3: bounded scan — an unbounded backlog makes the audit evidence
    // overflow permanently (ids are deterministic, never shrink).
    limit: opts.limit ?? DETECT_SCAN_LIMIT,
  });
  const candidates: ExceptionCandidate[] = [];
  for (const e of open) {
    // C4b: own-property check — `kind` values like "constructor" or
    // "__proto__" must not reach through the prototype chain.
    const type = Object.hasOwn(TYPE_BY_REASON, e.kind)
      ? TYPE_BY_REASON[e.kind]
      : undefined;
    if (type === undefined) {
      // Unknown kind — keep the work visible as a generic mismatch.
      candidates.push({
        id: `rx_${e.id}`,
        type: "AMOUNT_MISMATCH",
        subjectRef: e.paymentId ?? e.id,
        details: { source: "payment-exception", kind: e.kind, details: e.details },
      });
      continue;
    }
    if (type === null) continue; // REFUND_REQUEST — not reconciliation
    candidates.push({
      id: `rx_${e.id}`,
      type,
      subjectRef: e.paymentId ?? e.id,
      details: { source: "payment-exception", kind: e.kind, attemptId: e.attemptId, details: e.details },
    });
  }
  return detectExceptions(db, candidates);
}

/** N3: max rows one scan converts — keeps audit evidence bounded. */
const DETECT_SCAN_LIMIT = 100;

export interface ResolveExceptionInput {
  id: string;
  /** MATCHED|IGNORED|MANUAL_ADJUSTED|REFUNDED */
  resolution: string;
  operator: string;
  note?: string;
}

/**
 * OPEN → RESOLVED via the guarded store transition + audit row.
 * Resolving a RESOLVED/missing exception is a hard error — the audit
 * trail must reflect that nothing happened.
 */
export async function resolveException(
  db: Database,
  input: ResolveExceptionInput,
): Promise<FinOpsResult<ReconciliationExceptionRow>> {
  const guard = guardAction(input.operator, { note: input.note });
  if (guard) return guard;
  // N2: cap the note BEFORE the transition — it is echoed into the
  // audit evidence next to resolution/type/subjectRef, and an
  // uncapped note can overflow the row after the resolve landed.
  if (input.note !== undefined) {
    const cap = checkTextField(input.note, "note", MAX_TEXT_FIELD);
    if (cap) return cap;
  }
  if (!VALID_RESOLUTIONS.has(input.resolution)) {
    return fail(
      "BAD_INPUT",
      `resolution must be one of ${[...VALID_RESOLUTIONS].join("|")}`,
    );
  }
  const existing = await db.finops.exceptions.getById(input.id);
  if (!existing) {
    return fail("NOT_FOUND", `exception not found: ${input.id}`);
  }
  if (existing.status !== "OPEN") {
    return fail(
      "INVALID_STATE",
      `exception ${input.id} is ${existing.status}, not OPEN`,
    );
  }
  // Guarded transition first — losing the race returns INVALID_STATE
  // without a lying audit row; the audit then records what happened.
  const operator = normalizeOperator(input.operator);
  const resolved = await db.finops.exceptions.resolve(
    input.id,
    input.resolution,
    operator,
    Date.now(),
  );
  if (!resolved) {
    return fail(
      "INVALID_STATE",
      "exception transitioned concurrently — not resolved",
    );
  }
  const audit = await recordAdminAction(db, {
    action: "RESOLVE_EXCEPTION",
    subjectType: "exception",
    subjectId: input.id,
    operator,
    evidence: {
      resolution: input.resolution,
      note: input.note ?? null,
      type: existing.type,
      subjectRef: existing.subjectRef,
    },
  });
  if (!audit.ok) return audit;
  return ok(resolved);
}

/** Newest-first work-queue listing. */
export async function listExceptions(
  db: Database,
  opts?: {
    status?: string;
    type?: string;
    subjectRef?: string;
    sinceMs?: number;
    limit?: number;
  },
): Promise<ReconciliationExceptionRow[]> {
  return db.finops.exceptions.list(opts);
}
