import { emitKnowledgeEvent } from "./events";
import { gapTsMs } from "./gap-events";
import { gapOverdueId } from "./gap-overdue";
import { nowIso } from "./memory-data";
import type { KnowledgeStore } from "./store";

/**
 * EPIC-264 (SLICE-264-13, C8): overdue sweep body — the timer in
 * services/knowledge-overdue-sweeper.ts is only a wrapper; this is
 * the test seam (callable with the env gate off).
 *
 * Two phases per tick:
 *   1. due-scan → recordOverdue — breach ROWS exist for every
 *      currently-breached gap (unique (gapId,dueAt) generation;
 *      a moved deadline is a NEW breach, not a refresh).
 *   2. pending drain → emit → stamp — every emittedAt=NULL row
 *      owes its signal REGARDLESS of current gap state: a row
 *      stranded by a kill (or a gap that left the due set after
 *      the record) still emits — that is the catch-up the
 *      @@index([emittedAt]) exists for.
 *
 * Honest boundary: `emittedAt` stamps emit INVOCATION — the bus is
 * fire-and-forget (hook delivery is out of scope); the row is the
 * durable fact. Cross-process duplicate-emit is at-least-once —
 * consumers dedupe on (gapId,dueAt).
 */
export interface OverdueSweepResult {
  /** Breached gaps the due-scan returned this tick. */
  scanned: number;
  /** Newly created breach rows. */
  recorded: number;
  /** gap_overdue signals sent this tick (fresh + catch-up). */
  emitted: number;
  errors: string[];
}

export interface OverdueSweepDeps {
  store: Pick<
    KnowledgeStore,
    | "listDueBreaches"
    | "recordOverdue"
    | "markOverdueEmitted"
    | "listPendingOverdueEmits"
  >;
  /** Test seam — the tick clock; defaults to wall time. Note the
   *  console's overdue CASE uses DB now() — a sub-second app/DB
   *  clock skew can diverge badge vs scan momentarily (accepted,
   *  same as every sweeper in the codebase). */
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

  // Phase 1 — ensure breach rows exist for the current due set.
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
    } catch (err) {
      result.errors.push(
        `${gap.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Phase 2 — drain the durable-intent set: emittedAt IS NULL rows
  // emit + stamp, independent of whether the gap still breaches.
  const pending = await deps.store.listPendingOverdueEmits();
  for (const p of pending) {
    try {
      emit("knowledge.gap_overdue", {
        gapId: p.gapId,
        // Canonical ISO on the wire — gapTsMs normalizes the
        // PG-native "…ss+00" stamp before the ISO render (the
        // 264-12 PG-native-vs-ISO lesson); events.at is ISO.
        dueAt: new Date(gapTsMs(p.dueAt)).toISOString(),
        normalizedQuery: p.normalizedQuery,
        count: p.count,
      });
      await deps.store.markOverdueEmitted(p.id);
      result.emitted += 1;
    } catch (err) {
      result.errors.push(
        `${p.gapId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return result;
}
