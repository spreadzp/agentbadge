// EPIC-140 (SLICE-140-9): background jobs + error handler extracted from index.ts.
// startBackgroundJobs: env-gated HCS cache rebuilds + escrow reconciler sweeper.
// wireErrorHandler: app.onError → captureError + structured 500.

import type { Hono } from "hono";
import {
  startBackgroundRebuild,
  a2aStartBackgroundRebuild as startA2ACacheRebuild,
  marketStartBackgroundRebuild as startMarketCacheRebuild,
} from "@agentbadge/passport";
import { startEscrowReconciler } from "../services/escrow-reconciler";
import { startBountyLeaseSweeper } from "../services/bounty-lease-sweeper";
import { startBountyQaRunner } from "../services/bounty-qa-runner";
import { startVenueBillingSweeper } from "../lib/venue/billing";
import { captureError } from "../lib/sentry";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

// Rebuild directory/A2A/market caches from HCS in background (SLICE-7-2:
// graceful degradation — server starts immediately with empty cache, rebuilds
// in background with retries). Escrow reconciler sweeper is config-gated (SLICE-84-2).
export function startBackgroundJobs(): void {
  const directoryTopicId = process.env.DIRECTORY_TOPIC_ID;
  if (directoryTopicId) {
    startBackgroundRebuild(directoryTopicId, { incremental: true });
  }

  const a2aTopicId = process.env.A2A_TOPIC_ID;
  if (a2aTopicId) {
    startA2ACacheRebuild(a2aTopicId, { incremental: true });
  }

  const marketTopicId = process.env.MARKET_TOPIC_ID;
  if (marketTopicId) {
    startMarketCacheRebuild(marketTopicId, { incremental: true });
  }

  startEscrowReconciler();
  // 197-7: bounty lease sweeper (expired lease → reject → reopen).
  // Self-gates on BOUNTY_SWEEPER_ENABLED (default on).
  startBountyLeaseSweeper();
  // 197-9: QA runner (untrusted sha → isolated build/test/lint).
  // Explicit opt-in only: BOUNTY_QA_RUNNER_ENABLED=true.
  startBountyQaRunner();

  // 153-5: daily venue subscription sweep (active→grace→expired) —
  // env-gated with the venue feature flag + ARC_BV_SWEEPER_ENABLED.
  if (process.env.ARC_VENUE_ENABLED === "true") {
    startVenueBillingSweeper();
  }
}

// Capture unhandled errors from routes
export function wireErrorHandler(app: Hono): void {
  app.onError((err, c) => {
    console.error("[onError]", c.req.method, c.req.path, err);
    captureError(err, {
      tags: { path: c.req.path, method: c.req.method },
    });
    return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, "Internal server error");
  });
}
