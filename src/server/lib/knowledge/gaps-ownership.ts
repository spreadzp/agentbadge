import type { OperatorStore } from "../operators/store";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import type { KnowledgeGapRecord } from "./types";

/**
 * EPIC-264 (SLICE-264-10, D-264-Q8/Q9, C3): gap ownership domain
 * fns. Assignment is ORTHOGONAL to the lifecycle machine — a gap
 * stays OPEN/TRIAGED while it has an owner; RESOLVED/WONTFIX rows
 * refuse new assignment (a closed gap takes no work).
 *
 * Anti-laundering (C3): dueAt is an absolute UTC stamp that only
 * `setGapDueAt` (with a mandatory reason → 264-11 audit event) can
 * change. Reassigning hands or dropping the assignee NEVER resets
 * the deadline — otherwise an overdue gap could be laundered into
 * a fresh one by swapping `assignedTo`.
 *
 * Assignee must be an ACTIVE `human` operator (D-264-Q8): service
 * principals and break_glass can act but cannot OWN backlog work.
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
 *  never a form field); `dueAt` is an absolute UTC timestamp.
 *
 *  Anti-laundering (C3): assigning to a DIFFERENT owner is refused
 *  (`already_assigned` — that path is reassignGap); and a dueAt the
 *  gap already carries can only move via setGapDueAt (reason →
 *  audit), so assign may set a deadline on a fresh/unassigned gap
 *  but never silently rewrites or clears an existing one. */
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
  if (
    gap.dueAt !== null &&
    input.dueAt !== undefined &&
    input.dueAt !== gap.dueAt
  ) {
    return { ok: false, error: "due_at_change_needs_reason", field: "dueAt" };
  }
  const res = await store.assignGap(input.gapId, {
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    assignedAt: new Date().toISOString(),
    dueAt: input.dueAt ?? gap.dueAt,
  });
  if (!res.updated || !res.gap) return { ok: false, error: "not_found" };
  return { ok: true, gap: res.gap };
}

/** Reassign to a different operator — keeps the existing dueAt
 *  verbatim (C3 anti-laundering). Terminal gaps refuse. */
export async function reassignGap(
  store: KnowledgeStore,
  input: { gapId: string; assignedTo: string; assignedBy: string },
  deps: { operators: OperatorStore },
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  const pre = await assignable(store, input.gapId, input.assignedTo, deps);
  if (!pre.ok) return pre;
  const res = await store.assignGap(input.gapId, {
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    assignedAt: new Date().toISOString(),
    dueAt: pre.gap.dueAt,
  });
  if (!res.updated || !res.gap) return { ok: false, error: "not_found" };
  return { ok: true, gap: res.gap };
}

/** Drop the assignee — allowed on any status (terminal cleanup is
 *  legitimate). dueAt survives: an unassigned gap has no one to be
 *  late against, but re-adding an owner later must not reset the
 *  deadline (same anti-laundering rule as reassign). */
export async function unassignGap(
  store: KnowledgeStore,
  input: { gapId: string },
): Promise<KnowledgeResult<{ gap: KnowledgeGapRecord }>> {
  const gap = await store.getGap(input.gapId);
  if (!gap) return { ok: false, error: "not_found" };
  const res = await store.assignGap(input.gapId, {
    assignedTo: null,
    assignedBy: null,
    assignedAt: null,
    dueAt: gap.dueAt,
  });
  if (!res.updated || !res.gap) return { ok: false, error: "not_found" };
  return { ok: true, gap: res.gap };
}

/** Move (or clear, dueAt:null) the deadline. `reason` is REQUIRED —
 *  the 264-11 audit event carries it; a deadline change without a
 *  stated cause is exactly the laundering this field exists to
 *  prevent. */
export async function setGapDueAt(
  store: KnowledgeStore,
  input: {
    gapId: string;
    dueAt: string | null;
    reason: string;
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
  const res = await store.assignGap(input.gapId, {
    assignedTo: gap.assignedTo,
    assignedBy: gap.assignedBy,
    // Pass through — stamping `now()` here would fabricate an
    // assignment instant on an unassigned gap.
    assignedAt: gap.assignedAt,
    dueAt: input.dueAt,
  });
  if (!res.updated || !res.gap) return { ok: false, error: "not_found" };
  return { ok: true, gap: res.gap };
}
