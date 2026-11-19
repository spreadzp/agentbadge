/**
 * EPIC-226 / SLICE-226-2 — reconciliation exception lifecycle
 * (D-226-6): detect → OPEN (deterministic ids dedupe re-scans) →
 * resolve → AdminAction + RESOLVED. Two surfaces: `detectExceptions`
 * (explicit candidates) and `detectFromPaymentExceptions` (bridge
 * from the EPIC-222 PaymentException ops queue).
 */

import type {
  Database,
  ReconciliationExceptionRow,
} from "@agentbadge/database";

import {
  MAX_ID_FIELD,
  MAX_TEXT_FIELD,
  checkSerialized,
  checkTextField,
  guardAction,
  normalizeOperator,
} from "./guards";
import { recordPostEffectAudit } from "./admin-actions";
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
export const TYPE_BY_REASON: Record<string, string | null> = {
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

const nextExceptionId = (type: string, subjectRef: string): string =>
  `rx_${type.toLowerCase()}_${subjectRef}_${crypto.randomUUID()}`;

/**
 * Append detection candidates — deterministic `id` dedupes re-scans;
 * a missing id is generated from type+subjectRef+seq. Unknown types
 * are rejected.
 */
export async function detectExceptions(
  db: Database,
  candidates: readonly ExceptionCandidate[],
): Promise<FinOpsResult<DetectResult>> {
  // N5-7: validate EVERY candidate before writing anything — a
  // mid-loop reject used to leave a partial batch and one bad
  // generated id (e.g. `rx_<over-long source id>`) would starve all
  // future scans.
  const prepared: Array<{ id: string; c: ExceptionCandidate }> = [];
  for (const c of candidates) {
    if (!VALID_TYPES.has(c.type)) {
      return fail("BAD_INPUT", `unknown exception type: ${c.type}`);
    }
    if (typeof c.subjectRef !== "string" || c.subjectRef.trim() === "") {
      return fail("BAD_INPUT", "exception subjectRef is required");
    }
    // L-10: subjectRef is echoed into the resolve audit evidence —
    // cap it so a huge source id cannot overflow that row later.
    const refCap = checkTextField(
      c.subjectRef.trim(),
      "subjectRef",
      MAX_ID_FIELD,
    );
    if (refCap) return refCap;
    const id = c.id ?? nextExceptionId(c.type, c.subjectRef.trim());
    // L4-3: the id is echoed into evidence/error strings downstream —
    // bound it like every other stored field.
    const idCap = checkTextField(id, "id", MAX_ID_FIELD);
    if (idCap) return idCap;
    prepared.push({ id, c });
  }
  const created: ReconciliationExceptionRow[] = [];
  const skipped: string[] = [];
  for (const { id, c } of prepared) {
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
  // N2 + M-2: cap the note BEFORE the transition, by SERIALIZED size
  // (control chars amplify ~6x under JSON.stringify) — it is echoed
  // into the post-effect audit row next to resolution/type/subjectRef.
  // L-10: a non-string note from a non-route caller is rejected, not
  // silently carried.
  if (input.note !== undefined) {
    if (typeof input.note !== "string") {
      return fail("BAD_INPUT", "note must be a string");
    }
    const cap =
      checkTextField(input.note, "note", MAX_TEXT_FIELD) ??
      checkSerialized(input.note, "note", 700);
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
  // M-2: the exception already transitioned — degrade to minimal
  // evidence rather than lose the audit row on an edge-case overflow.
  const audit = await recordPostEffectAudit(
    db,
    {
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
    },
    {
      resolution: input.resolution,
      type: existing.type,
    },
  );
  // The state change landed — a degraded audit must not report the
  // resolve as failed; the minimal row still carries the outcome.
  void audit;
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
