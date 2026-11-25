import type { OperatorStore } from "../operators/store";
import type { KnowledgeResult } from "./items";
import { gapEventId, gapTsMs } from "./gap-events";
import type { KnowledgeStore } from "./store";
import type { KnowledgeGapRecord } from "./types";

/**
 * EPIC-264 (SLICE-264-10/11, D-264-Q8/Q9, C2/C3): gap ownership
 * domain fns. Assignment is ORTHOGONAL to the lifecycle machine —
 * a gap stays OPEN/TRIAGED while it has an owner; terminal rows
 * refuse new assignment. 264-11: every ownership write lands with
 * a persisted audit event in the SAME mutation.
 *
 * Anti-laundering (C3): dueAt only moves via `setGapDueAt` with a
 * mandatory reason — reassign/unassign NEVER reset the deadline,
 * or an overdue gap could be laundered by swapping `assignedTo`.
 * Assignee must be an ACTIVE `human` operator (D-264-Q8).
 */

const TERMINAL = new Set(["RESOLVED", "WONTFIX"]);

/** C3: dueAt is an ABSOLUTE UTC timestamp — must carry an explicit
 *  zone (`Z` or ±hh:mm). A naive ISO string parses as local time and
 *  would silently shift the deadline; a duration is not a deadline. */
const ISO_ABSOLUTE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const isTimestamp = (s: unknown): s is string =>
  typeof s === "string" &&
  ISO_ABSOLUTE.test(s) &&
  !Number.isNaN(Date.parse(s));

/** Instant compare — string equality refuses same-instant variants. */
const sameInstant = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : gapTsMs(a) === gapTsMs(b);
const dueChanged = (v: string | null | undefined, cur: string | null) =>
  v !== undefined && !sameInstant(v, cur);

/** CAS-fail cascade: re-read and report the FRESH state —
 *  converged rows return ok, a changed owner reports conflict. */
async function conflictReport(
  store: KnowledgeStore,
  gapId: string,
  converged: (gap: KnowledgeGapRecord) => boolean,
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  const fresh = await store.getGap(gapId);
  if (!fresh) return { ok: false, error: "not_found" };
  if (converged(fresh)) return { ok: true, gap: fresh };
  return { ok: false, error: "conflict" };
}

/** Shared assign/reassign preflight — gap exists, not terminal,
 *  assignee resolves to an active human operator. */
async function assignable(
  store: KnowledgeStore,
  gapId: string,
  assignedTo: string,
  deps: { operators: OperatorStore },
): Promise<
  | { ok: true; gap: KnowledgeGapRecord }
  | { ok: false; error: string; field?: string }
> {
  const gap = await store.getGap(gapId);
  if (!gap) return { ok: false, error: "not_found" };
  if (TERMINAL.has(gap.status)) {
    return { ok: false, error: "gap_terminal", field: "status" };
  }
  const op = await deps.operators.getOperator(assignedTo);
  if (!op) return { ok: false, error: "assignee_missing", field: "assignedTo" };
  if (op.principalType !== "human") {
    return { ok: false, error: "assignee_not_human", field: "assignedTo" };
  }
  if (op.status !== "active") {
    return { ok: false, error: "assignee_inactive", field: "assignedTo" };
  }
  return { ok: true, gap };
}

/** Assign a gap to an operator. `assignedBy` is the CALLING
 *  principal's id (the route resolves it from the credential —
 *  never a form field). A different owner is refused
 *  (`already_assigned` — that path is reassignGap); a deadline
 *  moves only via setGapDueAt (C3 — see the dueChanged gate). */
export async function assignGap(
  store: KnowledgeStore,
  input: {
    gapId: string;
    assignedTo: string;
    assignedBy: string;
    dueAt?: string | null;
  },
  deps: { operators: OperatorStore },
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  if (input.dueAt !== undefined && input.dueAt !== null && !isTimestamp(input.dueAt)) {
    return { ok: false, error: "bad_due_at", field: "dueAt" };
  }
  const pre = await assignable(store, input.gapId, input.assignedTo, deps);
  if (!pre.ok) return pre;
  const { gap } = pre;
  if (gap.assignedTo !== null && gap.assignedTo !== input.assignedTo) {
    return { ok: false, error: "already_assigned", field: "assignedTo" };
  }
  // C3 (264-12 review): any deadline change on an OWNED or
  // already-dated gap needs setGapDueAt (reason → audit) — the
  // only free first-set is assign-with-dueAt on an unassigned,
  // undated gap.
  if (
    dueChanged(input.dueAt, gap.dueAt) &&
    (gap.assignedTo !== null || gap.dueAt !== null)
  ) {
    return { ok: false, error: "due_at_change_needs_reason", field: "dueAt" };
  }
  // Same owner + unchanged deadline → nothing to write or audit.
  if (
    gap.assignedTo === input.assignedTo &&
    !dueChanged(input.dueAt, gap.dueAt)
  ) {
    return { ok: true, gap };
  }
  const now = new Date().toISOString();
  const dueAt = input.dueAt ?? gap.dueAt;
  const res = await store.assignGap(input.gapId, {
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    assignedAt: now,
    dueAt,
    // CAS + audit row in the same write — lands only while the
    // owner still is what this event claims to replace.
    // Arc-264-16 M3: expectedDueAt is the deadline half of the
    // CAS (all four writers) — the event's dueAt snapshot must
    // still equal our read or the write-back would stomp a
    // concurrent setGapDueAt.
    expectedAssignedTo: gap.assignedTo,
    expectedDueAt: gap.dueAt,
    event: {
      id: gapEventId(),
      gapId: input.gapId,
      kind: "assigned",
      actor: input.assignedBy,
      previousAssignee: gap.assignedTo,
      assignedTo: input.assignedTo,
      dueAt,
    },
  });
  if (res.reason === "conflict") {
    return conflictReport(store, input.gapId, (g) =>
      g.assignedTo === input.assignedTo && sameInstant(g.dueAt, dueAt));
  }
  if (!res.updated || !res.gap) return { ok: false, error: "not_found" };
  return { ok: true, gap: res.gap };
}

/** Reassign to a different operator — keeps the existing dueAt
 *  verbatim (C3 anti-laundering). Terminal gaps refuse. An
 *  optional `dueAt` in the input may only CONFIRM the kept
 *  deadline — any actual change belongs to setGapDueAt. */
export async function reassignGap(
  store: KnowledgeStore,
  input: {
    gapId: string;
    assignedTo: string;
    assignedBy: string;
    dueAt?: string;
  },
  deps: { operators: OperatorStore },
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  if (input.dueAt !== undefined && !isTimestamp(input.dueAt)) {
    return { ok: false, error: "bad_due_at", field: "dueAt" };
  }
  const pre = await assignable(store, input.gapId, input.assignedTo, deps);
  if (!pre.ok) return pre;
  const { gap } = pre;
  if (dueChanged(input.dueAt, gap.dueAt)) {
    return { ok: false, error: "due_at_change_needs_reason", field: "dueAt" };
  }
  if (gap.assignedTo === input.assignedTo) return { ok: true, gap };
  const now = new Date().toISOString();
  const res = await store.assignGap(input.gapId, {
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    assignedAt: now,
    dueAt: gap.dueAt,
    expectedAssignedTo: gap.assignedTo,
    expectedDueAt: gap.dueAt,
    event: {
      id: gapEventId(),
      gapId: input.gapId,
      kind: "reassigned",
      actor: input.assignedBy,
      previousAssignee: gap.assignedTo,
      assignedTo: input.assignedTo,
      dueAt: gap.dueAt,
    },
  });
  if (res.reason === "conflict") {
    return conflictReport(store, input.gapId, (g) =>
      g.assignedTo === input.assignedTo);
  }
  if (!res.updated || !res.gap) return { ok: false, error: "not_found" };
  return { ok: true, gap: res.gap };
}

/** Drop the assignee — allowed on any status (terminal cleanup is
 *  legitimate). dueAt survives: an unassigned gap has no one to be
 *  late against, but re-adding an owner later must not reset the
 *  deadline (same anti-laundering rule as reassign). `actor` = the
 *  calling principal — REQUIRED so the audit row says WHO dropped
 *  the owner even though the row itself clears assignedBy. */
export async function unassignGap(
  store: KnowledgeStore,
  input: { gapId: string; actor: string },
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  const gap = await store.getGap(input.gapId);
  if (!gap) return { ok: false, error: "not_found" };
  const res = await store.assignGap(input.gapId, {
    assignedTo: null,
    assignedBy: null,
    assignedAt: null,
    dueAt: gap.dueAt,
    // CAS: don't drop an owner that landed after our read. The dueAt
    // pin stays on owner-CLEAR — the UPDATE writes dueAt back; unpinned
    // it stomps a mid-flight setGapDueAt (confirm-3: conflict = fix).
    expectedAssignedTo: gap.assignedTo,
    expectedDueAt: gap.dueAt,
    // No owner → nothing was dropped: an "unassigned" row for a
    // no-op mutation is audit noise, not a fact.
    ...(gap.assignedTo === null
      ? {}
      : {
          event: {
            id: gapEventId(),
            gapId: input.gapId,
            kind: "unassigned" as const,
            actor: input.actor,
            previousAssignee: gap.assignedTo,
            assignedTo: null,
            dueAt: gap.dueAt,
          },
        }),
  });
  if (res.reason === "conflict") {
    return conflictReport(store, input.gapId, (g) => g.assignedTo === null);
  }
  if (!res.updated || !res.gap) return { ok: false, error: "not_found" };
  return { ok: true, gap: res.gap };
}

/** Move (or clear, dueAt:null) the deadline. `reason` + `actor`
 *  are REQUIRED — the audit event carries both; a deadline change
 *  without a stated cause is exactly the laundering this field
 *  exists to prevent. */
export async function setGapDueAt(
  store: KnowledgeStore,
  input: {
    gapId: string;
    dueAt: string | null;
    reason: string;
    actor: string;
  },
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length === 0) {
    return { ok: false, error: "reason_required", field: "reason" };
  }
  if (input.dueAt !== null && !isTimestamp(input.dueAt)) {
    return { ok: false, error: "bad_due_at", field: "dueAt" };
  }
  const gap = await store.getGap(input.gapId);
  if (!gap) return { ok: false, error: "not_found" };
  // Arc-264-16 confirm-2: a terminal OWNED gap re-installs that owner →
  // the store gate refuses every retry — report the permanent state,
  // not a looping conflict. UNOWNED terminal rows write legally.
  if (TERMINAL.has(gap.status) && gap.assignedTo !== null) {
    return { ok: false, error: "gap_terminal", field: "status" };
  }
  const res = await store.assignGap(input.gapId, {
    assignedTo: gap.assignedTo,
    assignedBy: gap.assignedBy,
    // Pass through — `now()` here would fabricate an assign instant.
    assignedAt: gap.assignedAt,
    dueAt: input.dueAt,
    // CAS: a mid-flight claim must not be stomped back to null.
    expectedAssignedTo: gap.assignedTo,
    expectedDueAt: gap.dueAt,
    event: {
      id: gapEventId(),
      gapId: input.gapId,
      kind: input.dueAt === null ? "due_cleared" : "due_set",
      actor: input.actor,
      assignedTo: gap.assignedTo,
      dueAt: input.dueAt,
      reason,
    },
  });
  if (res.reason === "conflict") {
    return conflictReport(store, input.gapId, (g) =>
      g.assignedTo === gap.assignedTo && sameInstant(g.dueAt, input.dueAt));
  }
  if (!res.updated || !res.gap) return { ok: false, error: "not_found" };
  return { ok: true, gap: res.gap };
}
