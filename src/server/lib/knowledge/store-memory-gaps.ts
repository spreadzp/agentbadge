import type { KnowledgeGapUpsert } from "./store";
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
    orderBy?: "count" | "lastSeen";
    limit?: number;
    offset?: number;
  }) {
    let rows = [...this.data.gaps.values()];
    if (opts?.status !== undefined) {
      rows = rows.filter((g) => g.status === opts.status);
    }
    rows.sort(
      opts?.orderBy === "lastSeen"
        ? (a, b) =>
            b.lastSeenAt.localeCompare(a.lastSeenAt) ||
            a.id.localeCompare(b.id)
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

  async transitionGap(
    id: string,
    input: {
      from: string;
      to: string;
      linkedItemId?: string | null;
      resolvedAt: string | null;
    },
  ) {
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
    return { gap, transitioned: true };
  }

  /** SLICE-264-10: idempotent overwrite — see KnowledgeStore.assignGap. */
  async assignGap(
    id: string,
    input: {
      assignedTo: string | null;
      assignedBy: string | null;
      assignedAt: string | null;
      dueAt: string | null;
    },
  ) {
    const gap = this.data.gaps.get(id);
    if (!gap) {
      return { gap: null, updated: false, reason: "missing" as const };
    }
    gap.assignedTo = input.assignedTo;
    gap.assignedBy = input.assignedBy;
    gap.assignedAt = input.assignedAt;
    gap.dueAt = input.dueAt;
    return { gap, updated: true };
  }
}
