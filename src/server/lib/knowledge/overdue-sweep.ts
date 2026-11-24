import { emitKnowledgeEvent } from "./events";
import { gapOverdueId } from "./gap-overdue";
import { nowIso } from "./memory-data";
import type { KnowledgeStore } from "./store";

/**
 * EPIC-264 (SLICE-264-13, C8): overdue sweep body — the timer in
 * services/knowledge-overdue-sweeper.ts is only a wrapper; this is
 * the test seam (`sweepOnce`-style, callable with the env gate off).
 *
 * Per breached gap: record → emit → stamp. `emittedAt` stays NULL
 * on any failure between record and mark, so the NEXT tick re-emits
 * — durable intent, not fire-and-lose. A returned row with
 * emittedAt set (repeat tick, same dueAt) is a no-op: the breach
 * was already signalled. A deadline extended past a breach is a
 * NEW (gapId,dueAt) generation → new row → new signal.
 */
export interface OverdueSweepResult {
  /** Breached gaps the store returned this tick. */
  scanned: number;
  /** Newly created breach rows. */
  recorded: number;
  /** gap_overdue signals sent this tick (record + catch-up). */
  emitted: number;
  errors: string[];
}

export interface OverdueSweepDeps {
  store: Pick<
    KnowledgeStore,
    "listDueBreaches" | "recordOverdue" | "markOverdueEmitted"
  >;
  /** Test seam — the tick clock; defaults to wall time. */
  now?: string;
  /** Test seam — observe the emitted payload without hooking the
   *  bus. Defaults to the real emitKnowledgeEvent fan-out. */
  emit?: (kind: string, payload: Record<string, unknown>) => void;
}

export async function sweepOverdueGaps(
  deps: OverdueSweepDeps,
): Promise<OverdueSweepResult> {
  const now = deps.now ?? nowIso();
  const emit = deps.emit ?? emitKnowledgeEvent;
  const result: OverdueSweepResult = {
    scanned: 0,
    recorded: 0,
    emitted: 0,
    errors: [],
  };
  const breaches = await deps.store.listDueBreaches(now);
  result.scanned = breaches.length;
  for (const gap of breaches) {
    try {
      const r = await deps.store.recordOverdue({
        id: gapOverdueId(),
        gapId: gap.id,
        dueAt: gap.dueAt as string,
        detectedAt: now,
      });
      if (r.created) result.recorded += 1;
      // emittedAt null covers BOTH a fresh row AND the catch-up row
      // (prior tick killed between record and mark — C8 recovery).
      if (r.row && r.row.emittedAt === null) {
        emit("knowledge.gap_overdue", {
          gapId: gap.id,
          // Canonical ISO on the wire — PG-native "…ss+00" stamps
          // must not leak into the event payload (events.at is ISO).
          dueAt: new Date(r.row.dueAt).toISOString(),
          normalizedQuery: gap.normalizedQuery,
          count: gap.count,
        });
        await deps.store.markOverdueEmitted(r.row.id);
        result.emitted += 1;
      }
    } catch (err) {
      result.errors.push(
        `${gap.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return result;
}
