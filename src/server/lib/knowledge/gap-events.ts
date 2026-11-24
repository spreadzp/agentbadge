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
 *  `assignedTo`/`dueAt` snapshot the state the write replaced —
 *  CAS-verified: assignGap's expectedAssignedTo guarantees the
 *  row still held those values when the event landed (264-12
 *  review), so previousAssignee is a real chain, not two racing
 *  intents. */
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

/** Epoch-ms for either timestamp shape — PG codec stamps can arrive
 *  native ("YYYY-MM-DD HH:mm:ss+00"), so lexical compares and raw
 *  Date.parse both need the space→T normalize first. */
export const gapTsMs = (s: string) =>
  Date.parse(s.includes("T") ? s : s.replace(" ", "T"));

/** Canonical overdue derivation (D-264-Q10): past-due ONLY while
 *  the gap still needs work — a RESOLVED row can't be "late".
 *  Single source for the view badge, the memory overdue-sort flag,
 *  and the SQL CASE in the package repo (keep all three in step). */
export const isGapOverdue = (
  g: { status: string; dueAt: string | null },
  now: string,
) =>
  g.dueAt !== null &&
  gapTsMs(g.dueAt) < gapTsMs(now) &&
  (g.status === "OPEN" || g.status === "TRIAGED");

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
 *  lands in the same write. `expectedAssignedTo` is the CAS
 *  predicate (264-12 review): the write only lands while the owner
 *  still equals the caller's read, so the event can't mint a
 *  previousAssignee built on a stale snapshot. `event` stays
 *  optional for non-domain callers (seeds, migrations, test
 *  plumbing) — the DOMAIN writers always pass one; skipping it is
 *  a caller-discipline contract, not a gap in the schema. */
export interface KnowledgeGapAssignInput extends KnowledgeGapAssignment {
  expectedAssignedTo?: string | null;
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
