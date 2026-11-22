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

  async recordGap(input: KnowledgeGapUpsert) {
    const now = nowIso();
    for (const gap of this.data.gaps.values()) {
      if (gap.normalizedQuery !== input.normalizedQuery) continue;
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
      // Arc R1 M7: renewed demand on a closed gap reopens it — a
      // re-sighting must not stay invisible to operators.
      if (gap.status === "RESOLVED" || gap.status === "WONTFIX") {
        gap.status = "OPEN";
        gap.linkedItemId = null;
      }
      if (
        gap.sampleQueries.length < KNOWLEDGE_GAP_SAMPLES_CAP &&
        !gap.sampleQueries.includes(input.sampleQuery)
      ) {
        gap.sampleQueries.push(input.sampleQuery);
      }
      return { row: gap, created: false };
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
      firstSeenAt: now,
      lastSeenAt: now,
    };
    this.data.gaps.set(gap.id, gap);
    return { row: gap, created: true };
  }

  async getGap(id: string) {
    return this.data.gaps.get(id) ?? null;
  }

  async listGaps(opts?: {
    status?: string;
    orderBy?: "count" | "lastSeen";
    limit?: number;
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
    return rows.slice(0, opts?.limit ?? 500);
  }

  async countGaps(status: string) {
    let n = 0;
    for (const g of this.data.gaps.values()) if (g.status === status) n += 1;
    return n;
  }

  async transitionGap(
    id: string,
    input: { from: string; to: string; linkedItemId?: string | null },
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
    return { gap, transitioned: true };
  }
}
