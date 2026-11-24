/**
 * SLICE-264-13: knowledge gap overdue sweeper — timer wrapper.
 *
 * Core sweep logic lives in `lib/knowledge/overdue-sweep.ts`
 * (durable breach record → knowledge.gap_overdue emit → emittedAt
 * stamp, kill-safe via the NULL mark, C8).
 *
 * Timer pattern mirrors bounty-lease-sweeper.ts:
 * KNOWLEDGE_OVERDUE_SWEEPER_ENABLED env gate (default on), first
 * tick +30s after boot, 15min interval ±30s jitter.
 */
import { logger } from "@agentbadge/passport/logger";

import { getDatabase } from "../lib/database";
import { pickKnowledgeStores } from "../lib/knowledge";
import { sweepOverdueGaps } from "../lib/knowledge/overdue-sweep";

export { sweepOverdueGaps } from "../lib/knowledge/overdue-sweep";
export type {
  OverdueSweepDeps,
  OverdueSweepResult,
} from "../lib/knowledge/overdue-sweep";

let sweeperTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_TICK_MS = 30_000;
const JITTER_MS = 30_000;

export function startKnowledgeOverdueSweeper(opts?: {
  intervalMs?: number;
}): void {
  const enabled = process.env.KNOWLEDGE_OVERDUE_SWEEPER_ENABLED !== "false";
  if (!enabled) {
    logger.info(
      "Knowledge overdue sweeper disabled (KNOWLEDGE_OVERDUE_SWEEPER_ENABLED=false)",
    );
    return;
  }
  if (sweeperTimer) {
    logger.warn("Knowledge overdue sweeper already running");
    return;
  }
  const baseInterval =
    opts?.intervalMs ??
    (Number(process.env.KNOWLEDGE_OVERDUE_INTERVAL_MS) ||
      DEFAULT_INTERVAL_MS);
  const tick = async () => {
    try {
      const store = pickKnowledgeStores(getDatabase());
      const r = await sweepOverdueGaps({ store });
      if (r.recorded > 0 || r.errors.length > 0) {
        logger.info("Knowledge overdue sweeper tick", {
          scanned: r.scanned,
          recorded: r.recorded,
          emitted: r.emitted,
          errors: r.errors.length,
        });
      }
    } catch (err) {
      logger.error("Knowledge overdue sweeper tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      const jitter = Math.random() * (JITTER_MS * 2) - JITTER_MS;
      sweeperTimer = setTimeout(tick, Math.max(1000, baseInterval + jitter));
    }
  };
  sweeperTimer = setTimeout(tick, FIRST_TICK_MS);
}

export function stopKnowledgeOverdueSweeper(): void {
  if (sweeperTimer) {
    clearTimeout(sweeperTimer);
    sweeperTimer = null;
  }
}
