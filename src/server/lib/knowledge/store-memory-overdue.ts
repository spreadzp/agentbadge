import type { KnowledgeGapOverdueInsert } from "./store";
import type {
  KnowledgeGapMetrics,
  KnowledgeGapOverduePending,
  KnowledgeGapOverdueRecord,
} from "./gap-overdue";
import { gapTsMs, isGapOverdue } from "./gap-events";
import type { KnowledgeGapRecord } from "./types";
import { nowIso, type MemoryKnowledgeData } from "./memory-data";

/**
 * EPIC-264 (SLICE-264-13): memory-side overdue-breach records —
 * durable (gapId,dueAt) breach rows, split from store-memory-gaps
 * (300-line cap). Honest-signal shapes identical to the PG adapter:
 * conflict → existing row + created:false; mark → updated flag.
 * dueAt compares run on epoch ms — the PG unique key is on the
 * timestamp VALUE, so "+00:00" and "Z" spellings of one instant
 * are the same breach generation here too.
 */
export class MemoryKnowledgeOverdue {
  constructor(private readonly data: MemoryKnowledgeData) {}

  /** Atomic breach record — scan is the (gapId,dueAt) unique key;
   *  found → the EXISTING row back with created:false (sweeper
   *  needs emittedAt either way — kill-between-record-and-emit). */
  async recordOverdue(input: KnowledgeGapOverdueInsert) {
    const dueMs = Date.parse(input.dueAt);
    for (const row of this.data.gapOverdues.values()) {
      if (row.gapId === input.gapId && Date.parse(row.dueAt) === dueMs) {
        return { row, created: false };
      }
    }
    const row: KnowledgeGapOverdueRecord = {
      id: input.id,
      gapId: input.gapId,
      dueAt: input.dueAt,
      detectedAt: input.detectedAt ?? nowIso(),
      emittedAt: null,
    };
    this.data.gapOverdues.set(row.id, row);
    return { row, created: true };
  }

  /** Idempotent emit stamp — already-stamped or unknown → false. */
  async markOverdueEmitted(id: string) {
    const row = this.data.gapOverdues.get(id);
    if (!row || row.emittedAt !== null) return { updated: false };
    row.emittedAt = nowIso();
    return { updated: true };
  }

  /** Breached at `now` — OPEN|TRIAGED only, NULL dueAt can't breach
   *  (mirrors the PG `dueAt < now` predicate), dueAt ASC + id tie.
   *  Arc-264-16 H1: already-recorded (gapId,dueAt) pairs leave the
   *  scan set — the PG NOT EXISTS mirror; without it the same rows
   *  re-present every tick (in PG they starved rank-501+). */
  async listDueBreaches(now: string) {
    const nowMs = Date.parse(now);
    const recorded = new Set(
      [...this.data.gapOverdues.values()].map((o) => `${o.gapId}${o.dueAt}`),
    );
    const rows: KnowledgeGapRecord[] = [...this.data.gaps.values()].filter(
      (g) =>
        (g.status === "OPEN" || g.status === "TRIAGED") &&
        g.dueAt !== null &&
        Date.parse(g.dueAt) < nowMs &&
        !recorded.has(`${g.id}${g.dueAt}`),
    );
    rows.sort((a, b) => {
      const d = Date.parse(a.dueAt as string) - Date.parse(b.dueAt as string);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
    return rows;
  }

  /** The drain set — emittedAt IS NULL regardless of gap state
   *  (kill-stranded rows still owe their signal). Gap fields come
   *  off the live record; a vanished gap reports nulls (the PG
   *  LEFT JOIN mirror). detectedAt ASC + id = FIFO order. */
  async listPendingOverdueEmits() {
    const pending = [...this.data.gapOverdues.values()].filter(
      (o) => o.emittedAt === null,
    );
    pending.sort((a, b) => {
      const d = Date.parse(a.detectedAt) - Date.parse(b.detectedAt);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
    return pending.map((o) => {
      const gap = this.data.gaps.get(o.gapId);
      return {
        id: o.id,
        gapId: o.gapId,
        dueAt: o.dueAt,
        normalizedQuery: gap?.normalizedQuery ?? null,
        count: gap?.count ?? null,
      } satisfies KnowledgeGapOverduePending;
    });
  }

  /** 264-14: memory mirror of the SQL digest — same liveness
   *  rule (isGapOverdue), same percentile_cont(0.5) interpolation
   *  (even-n → mean of the two middle values). */
  async gapMetrics(input: {
    now: string;
    resolvedSince: string;
  }): Promise<KnowledgeGapMetrics> {
    let overdueCount = 0;
    let unassignedCount = 0;
    const durationsMs: number[] = [];
    const sinceMs = gapTsMs(input.resolvedSince);
    for (const g of this.data.gaps.values()) {
      if (isGapOverdue(g, input.now)) overdueCount++;
      if (
        (g.status === "OPEN" || g.status === "TRIAGED") &&
        g.assignedTo === null
      ) {
        unassignedCount++;
      }
      if (
        g.status === "RESOLVED" &&
        g.resolvedAt !== null &&
        gapTsMs(g.resolvedAt) >= sinceMs
      ) {
        durationsMs.push(gapTsMs(g.resolvedAt) - gapTsMs(g.firstSeenAt));
      }
    }
    durationsMs.sort((a, b) => a - b);
    const n = durationsMs.length;
    const medianMs =
      n === 0
        ? null
        : n % 2 === 1
          ? durationsMs[(n - 1) / 2]
          : (durationsMs[n / 2 - 1] + durationsMs[n / 2]) / 2;
    return {
      overdueCount,
      unassignedCount,
      breachesTotal: this.data.gapOverdues.size,
      resolvedInWindow: n,
      timeToClearAvgSec:
        n === 0
          ? null
          : durationsMs.reduce((s, d) => s + d, 0) / n / 1000,
      timeToClearMedianSec: medianMs === null ? null : medianMs / 1000,
    };
  }
}
