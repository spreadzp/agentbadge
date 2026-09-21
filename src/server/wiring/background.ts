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
