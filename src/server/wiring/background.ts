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
import { startBoardOutboxDispatcher } from "../lib/board/dispatch";
import { startArchiveWorkers } from "./archive-workers";
import { getDatabase } from "../lib/database";
import { getConfig } from "../../config/env";
import { captureError } from "../lib/sentry";
import { passportChainEnabled } from "../lib/passport-chain-gate";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

// Resilience (2026-10-26 outage): a dead/unreachable database must never
// take the whole process down — Prisma Postgres planLimitReached (P6003)
// turned a marker-read rejection into a Bun exit-1 crash loop and ~20h of
// downtime. Registered at module scope so the guards are active before
// boot-time store hydration runs (wireErrorHandler below is called late).
// DB-facing stores degrade to in-memory mirrors; errors surface loudly,
// they do not kill the server.
process.on("unhandledRejection", (reason: unknown) => {
  console.error("[process] unhandled rejection:", reason);
  captureError(reason instanceof Error ? reason : new Error(String(reason)));
});
process.on("uncaughtException", (err: Error) => {
  console.error("[process] uncaught exception:", err);
  captureError(err);
});

// Rebuild directory/A2A/market caches from HCS in background (SLICE-7-2:
// graceful degradation — server starts immediately with empty cache, rebuilds
// in background with retries). Escrow reconciler sweeper is config-gated (SLICE-84-2).
export function startBackgroundJobs(): void {
  // SLICE-169-9: HCS cache rebuilds are Hedera-chain — skip entirely when
  // PASSPORT_CHAIN_ENABLED is off so no chain module is ever imported.
  if (passportChainEnabled()) {
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
  }

  startEscrowReconciler();
  // 197-7: bounty lease sweeper (expired lease → reject → reopen).
  // Self-gates on BOUNTY_SWEEPER_ENABLED (default on).
  startBountyLeaseSweeper();
  // 197-9: QA runner (untrusted sha → isolated build/test/lint).
  // Explicit opt-in only: BOUNTY_QA_RUNNER_ENABLED=true.
  startBountyQaRunner();

  // 199-13 D-199-7: ChainTxOutbox dispatcher — drains pending rows and
  // ships the chain leg (createJob/setProvider+fund/submit/complete/
  // reject/claimRefund/giveFeedback) as the ops signer. Self-gates on
  // ERC8183_REF_ADDRESS + BOARD_DISPATCHER_ENABLED (default on).
  startBoardOutboxDispatcher();

  // 153-5: daily venue subscription sweep (active→grace→expired) —
  // env-gated with the venue feature flag + ARC_BV_SWEEPER_ENABLED.
  if (process.env.ARC_VENUE_ENABLED === "true") {
    startVenueBillingSweeper();
  }

  // 217-8/217-9: TG archive workers (daily digest + weekly rollup doc).
  // Self-gates on DATABASE_ENABLED + TG creds; logs skip-reason.
  startArchiveWorkers({
    events: getDatabase().events,
    db: getDatabase(),
    databaseEnabled: getConfig().database?.enabled ?? false,
  });
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
