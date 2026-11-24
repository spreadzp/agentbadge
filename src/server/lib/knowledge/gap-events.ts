import { generateReportId } from "../../../agent-readiness/integrity/ulid";

/**
 * EPIC-264 (SLICE-264-11, C2): persisted gap audit — types and
 * vocab shared by the store contract, both backends, and the
 * domain writers. Split out of store.ts/types.ts (300-line cap).
 *
 * `assignedTo`/`dueAt` carry the post-event snapshot so each row
 * reads self-contained (assign→reassign→due-change is visible
 * row-by-row); `previousAssignee` is the handover chain — only
 * set on assigned/unassigned/reassigned.
 */

/** Closed vocab — enforced at the domain layer (the DB column is
 *  plain text). */
export const KNOWLEDGE_GAP_EVENT_KINDS = [
  "assigned",
  "unassigned",
  "reassigned",
  "due_set",
  "due_cleared",
  "triaged",
  "resolved",
  "wontfix",
  "reopened",
] as const;
export type KnowledgeGapEventKind = (typeof KNOWLEDGE_GAP_EVENT_KINDS)[number];

/** The stored audit row — append-only. */
export interface KnowledgeGapEventRecord {
  id: string;
  gapId: string;
  kind: string;
  /** principal.id (op_*); "system" on auto-reopen. */
  actor: string;
  previousAssignee: string | null;
  assignedTo: string | null;
  dueAt: string | null;
  /** REQUIRED on due_set/due_cleared (C3 anti-laundering). */
  reason: string | null;
  occurredAt: string;
  createdAt: string;
}

/** Audit-row write shape — `occurredAt` omitted → the WRITER stamps
 *  it (PG now() is µs-precise; memory keeps insertion order on
 *  ties). A caller-supplied ms stamp would tie same-ms writes into
 *  an arbitrary order — the store is the honest clock.
 *
 *  `assignedTo`/`dueAt` snapshot the writer's INTENT (the values it
 *  read pre-write), not a CAS-verified row — two operators racing
 *  the same gap can each log their own read. Owner mutations are
 *  low-contention admin calls; a row-lock contract is a future
 *  slice's problem, not C2's. */
export interface KnowledgeGapEventInsert {
  id: string;
  gapId: string;
  kind: KnowledgeGapEventKind;
  /** principal.id (op_*); "system" on auto-reopen. */
  actor: string;
  previousAssignee?: string | null;
  assignedTo?: string | null;
  dueAt?: string | null;
  reason?: string | null;
  occurredAt?: string;
}

/** ULID — the listGapEvents id-tiebreak orders cross-ms ties by
 *  creation sequence (a random suffix can't). */
export const gapEventId = () => `kgev_${generateReportId()}`;

/** SLICE-264-10: the four ownership columns, written atomically.
 *  All nullable — unassign clears the triple; setGapDueAt passes
 *  the current row's values through unchanged. */
export interface KnowledgeGapAssignment {
  assignedTo: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  dueAt: string | null;
}

/** assignGap write shape — the four columns + the audit row that
 *  lands in the same write. `event` stays optional for non-domain
 *  callers (seeds, migrations, test plumbing) — the DOMAIN writers
 *  always pass one; skipping it is a caller-discipline contract,
 *  not a gap in the schema. */
export interface KnowledgeGapAssignInput extends KnowledgeGapAssignment {
  event?: KnowledgeGapEventInsert;
}

/** transitionGap write shape — `resolvedAt` REQUIRED (SLICE-264-10:
 *  an omission must not silently wipe the stamp); `event` is the
 *  audit row written atomically with the mutation — same optional-
 *  for-non-domain-callers contract as assignGap. */
export interface KnowledgeGapTransitionInput {
  from: string;
  to: string;
  linkedItemId?: string | null;
  resolvedAt: string | null;
  event?: KnowledgeGapEventInsert;
}

/** Lifecycle audit row for triage/resolve/wontfix — actor = the
 *  principal who moved the gap ("system" when the store-direct
 *  caller passes none). assignedTo/dueAt snapshot the owner and
 *  deadline the transition happened under. */
export const lifecycleGapEvent = (
  gap: { id: string; assignedTo: string | null; dueAt: string | null },
  to: "TRIAGED" | "RESOLVED" | "WONTFIX",
  actor?: string,
): KnowledgeGapEventInsert => ({
  id: gapEventId(),
  gapId: gap.id,
  kind: to.toLowerCase() as "triaged" | "resolved" | "wontfix",
  actor: actor ?? "system",
  assignedTo: gap.assignedTo,
  dueAt: gap.dueAt,
});
