import type {
  KnowledgeGapAssignInput,
  KnowledgeGapTransitionInput,
  KnowledgeGapUpsert,
} from "./store";
import {
  gapEventId,
  isGapOverdue,
  type KnowledgeGapEventInsert,
} from "./gap-events";
import type { KnowledgeGapEventRecord } from "./gap-events";
import type { KnowledgeGapRecord } from "./types";
import {
  KNOWLEDGE_GAP_SAMPLES_CAP,
  nowIso,
  type MemoryKnowledgeData,
} from "./memory-data";

/**
 * EPIC-229 (SLICE-229-1): memory-side knowledge gaps — persisted
 * demand signals with lifecycle. Split from store-memory-taxonomy
 * (300-line file cap). Honest-signal shapes identical to the
 * Postgres adapter.
 */
export class MemoryKnowledgeGaps {
  constructor(protected readonly data: MemoryKnowledgeData) {}

  /** 264-11: normalize an insert into a stored record — same
   *  defaults as the PG INSERT (null fields, now() stamps). Called
   *  inside each mutation so event+state land together — the
   *  memory-store equivalent of the PG same-tx guarantee. */
  private pushEvent(e: KnowledgeGapEventInsert): KnowledgeGapEventRecord {
    const row: KnowledgeGapEventRecord = {
      id: e.id,
      gapId: e.gapId,
      kind: e.kind,
      actor: e.actor,
      previousAssignee: e.previousAssignee ?? null,
      assignedTo: e.assignedTo ?? null,
      dueAt: e.dueAt ?? null,
      reason: e.reason ?? null,
      occurredAt: e.occurredAt ?? nowIso(),
      createdAt: nowIso(),
    };
    this.data.gapEvents.set(row.id, row);
    return row;
  }

  async recordGap(input: KnowledgeGapUpsert, opts?: { openCap?: number }) {
    const now = nowIso();
    for (const gap of this.data.gaps.values()) {
      if (gap.normalizedQuery !== input.normalizedQuery) continue;
      // Arc R2 M-1: WONTFIX is an operator decision — final. The
      // sighting is returned untouched, recorded:false, so the
      // anonymous backlog can't silently revert a triage call.
      if (gap.status === "WONTFIX") {
        return { row: gap, created: false, recorded: false };
      }
      // RESOLVED gaps reopen on renewed demand; OPEN/TRIAGED just
      // bump. Reopened flags the caller to emit an event.
      // Arc R3 M-8: the reopen is cap-guarded — a full backlog can't
      // be re-flooded by replaying resolved queries (PG same).
      let reopened = false;
      if (gap.status === "RESOLVED") {
        let open = 0;
        if (opts?.openCap !== undefined) {
          for (const g of this.data.gaps.values()) {
            if (g.status === "OPEN") open += 1;
          }
        }
        if (opts?.openCap === undefined || open < opts.openCap) {
          reopened = true;
        }
      }
      gap.count += 1;
      gap.lastSeenAt = now;
      if (gap.capabilityRef == null && input.capabilityRef != null) {
        gap.capabilityRef = input.capabilityRef;
      }
      if (gap.intent == null && input.intent != null) {
        gap.intent = input.intent;
      }
      if (gap.sourceRef == null && input.sourceRef != null) {
        gap.sourceRef = input.sourceRef;
      }
      if (reopened) {
        gap.status = "OPEN";
        gap.linkedItemId = null;
        // SLICE-264-10: the resolution is un-done — the stamp must
        // not survive the reopen (PG bump path clears it too).
        gap.resolvedAt = null;
        // 264-11: the audit row lands in the same write — actor
        // "system" (a sighting reopened it, no principal acted).
        this.pushEvent({
          id: gapEventId(),
          gapId: gap.id,
          kind: "reopened",
          actor: "system",
          assignedTo: gap.assignedTo,
          dueAt: gap.dueAt,
        });
      }
      if (
        gap.sampleQueries.length < KNOWLEDGE_GAP_SAMPLES_CAP &&
        !gap.sampleQueries.includes(input.sampleQuery)
      ) {
        gap.sampleQueries.push(input.sampleQuery);
      }
      return { row: gap, created: false, recorded: true, reopened };
    }
    // New row — same openCap semantics as the PG adapter: only new
    // rows are cap-gated; dedupe bumps above never consult it.
    if (opts?.openCap !== undefined) {
      let open = 0;
      for (const g of this.data.gaps.values()) {
        if (g.status === "OPEN") open += 1;
      }
      if (open >= opts.openCap) {
        return { row: null, created: false, recorded: false };
      }
    }
    const gap: KnowledgeGapRecord = {
      id: input.id,
      normalizedQuery: input.normalizedQuery,
      sampleQueries: [input.sampleQuery],
      count: 1,
      capabilityRef: input.capabilityRef ?? null,
      intent: input.intent ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      status: "OPEN",
      linkedItemId: null,
      assignedTo: null,
      assignedBy: null,
      assignedAt: null,
      dueAt: null,
      resolvedAt: null,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    this.data.gaps.set(gap.id, gap);
    return { row: gap, created: true, recorded: true };
  }

  async getGap(id: string) {
    return this.data.gaps.get(id) ?? null;
  }

  async listGaps(opts?: {
    status?: string;
    orderBy?: "count" | "lastSeen" | "overdue";
    unassigned?: boolean;
    limit?: number;
    offset?: number;
  }) {
    let rows = [...this.data.gaps.values()];
    if (opts?.status !== undefined) {
      rows = rows.filter((g) => g.status === opts.status);
    }
    if (opts?.unassigned === true) {
      rows = rows.filter((g) => g.assignedTo === null);
    }
    const overdueFirst = (a: KnowledgeGapRecord, b: KnowledgeGapRecord) => {
      const now = nowIso();
      const flag = (g: KnowledgeGapRecord) => (isGapOverdue(g, now) ? 0 : 1);
      return (
        flag(a) - flag(b) ||
        b.count - a.count ||
        b.lastSeenAt.localeCompare(a.lastSeenAt) ||
        a.id.localeCompare(b.id)
      );
    };
    rows.sort(
      opts?.orderBy === "lastSeen"
        ? (a, b) =>
            b.lastSeenAt.localeCompare(a.lastSeenAt) ||
            a.id.localeCompare(b.id)
        : opts?.orderBy === "overdue"
          ? overdueFirst
          : (a, b) => b.count - a.count || a.id.localeCompare(b.id),
    );
    const offset = opts?.offset ?? 0;
    return rows.slice(offset, offset + (opts?.limit ?? 500));
  }

  async countGaps(status: string) {
    let n = 0;
    for (const g of this.data.gaps.values()) if (g.status === status) n += 1;
    return n;
  }

  async transitionGap(id: string, input: KnowledgeGapTransitionInput) {
    const gap = this.data.gaps.get(id);
    if (!gap) {
      return { gap: null, transitioned: false, reason: "missing" as const };
    }
    if (gap.status !== input.from) {
      return {
        gap,
        transitioned: false,
        reason: "status_mismatch" as const,
      };
    }
    gap.status = input.to;
    if (input.linkedItemId !== undefined) gap.linkedItemId = input.linkedItemId;
    // SLICE-264-10: always written (PG mirrors) — RESOLVED stamps,
    // everything else writes null.
    gap.resolvedAt = input.resolvedAt;
    // 264-11: audit row in the same call — never a mutation alone.
    if (input.event !== undefined) this.pushEvent(input.event);
    return { gap, transitioned: true };
  }

  /** SLICE-264-10: idempotent overwrite — see KnowledgeStore.assignGap. */
  async assignGap(id: string, input: KnowledgeGapAssignInput) {
    const gap = this.data.gaps.get(id);
    if (!gap) {
      return { gap: null, updated: false, reason: "missing" as const };
    }
    // CAS (264-12 review): the owner must still equal the caller's
    // read or the event's previousAssignee would mint a lie.
    if (
      input.expectedAssignedTo !== undefined &&
      gap.assignedTo !== input.expectedAssignedTo
    ) {
      return { gap: null, updated: false, reason: "conflict" as const };
    }
    gap.assignedTo = input.assignedTo;
    gap.assignedBy = input.assignedBy;
    gap.assignedAt = input.assignedAt;
    gap.dueAt = input.dueAt;
    if (input.event !== undefined) this.pushEvent(input.event);
    return { gap, updated: true };
  }

  /** 264-11: standalone audit append (see KnowledgeStore.appendGapEvent). */
  async appendGapEvent(event: KnowledgeGapEventInsert) {
    this.pushEvent(event);
    return true;
  }

  /** 264-11: chronological audit — occurredAt ASC. Sort is stable:
   *  same-stamp rows keep insertion order, which IS write order —
   *  the memory analog of PG's µs-precision now() ordering. */
  async listGapEvents(gapId: string) {
    const rows = [...this.data.gapEvents.values()].filter(
      (e) => e.gapId === gapId,
    );
    rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    return rows;
  }
}
