/**
 * SLICE-152-5: venue indexer + stats routes.
 *
 * - POST /api/indexer/run?scope=venue — one-shot index pass (chunked getLogs
 *   over ACP + Memo contracts, watermark resume, reorg rewind).
 * - GET /api/venue/indexer/health — watermark, lag, last run.
 * - GET /api/venue/stats — aggregates from the local index (D5-152 read path).
 *
 * Extracted from venue-api.ts (max-lines). Deps flow through VenueDeps.
 */
import type { Hono } from "hono";
import type { VenueIndexerDeps } from "../../lib/venue/indexer";
import { runVenueIndexer, venueIndexerHealth } from "../../lib/venue/indexer";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { opsBearerAuth } from "../../middleware/ops-auth";
import { logger } from "@agentbadge/passport/logger";
import { dr } from "./venue-api-helpers";

export interface VenueIndexerRouteDeps {
  indexer?: VenueIndexerDeps;
}

/** SLICE-234-39: retryable только для transient-сбоев (timeout/conn/
 *  rate-limit/upstream 5xx); pruned-history/range/reorg — детерминированные
 *  ошибки конфигурации, ретрай их не чинит. */
function isTransientIndexerError(msg: string): boolean {
  if (/pruned|out of range|block range|reorg|not.*configur|missing/i.test(msg)) {
    return false;
  }
  return /time.?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|429|rate.?limit|502|503|unavailable|overloaded/i.test(msg);
}

export function registerVenueIndexerRoutes(
  app: Hono,
  deps: VenueIndexerRouteDeps = {},
): void {
  const indexerDeps = deps.indexer ?? {};

  // POST /api/indexer/run?scope=venue — on-demand index pass (operator/CI).
  // SLICE-234-39: opsBearerAuth — иначе любой бот жжёт наш RPC-квоту.
  app.post("/api/indexer/run", opsBearerAuth(), dr("Run venue indexer pass"), async (c) => {
    const scope = c.req.query("scope") ?? "venue";
    if (scope !== "venue") {
      return errorResponse(
        c,
        400,
        ErrorCodes.INVALID_INPUT,
        `unknown scope "${scope}" — supported: venue`,
      );
    }
    try {
      const result = await runVenueIndexer(indexerDeps);
      return c.json({ scope, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("venue indexer run failed", { error: msg });
      return errorResponse(
        c,
        500,
        ErrorCodes.INTERNAL_ERROR,
        "indexer run failed",
        { retryable: isTransientIndexerError(msg) },
      );
    }
  });

  // GET /api/venue/indexer/health — watermark, lag, last run stats.
  app.get("/api/venue/indexer/health", dr("Venue indexer health"), async (c) => {
    const health = await venueIndexerHealth(indexerDeps);
    return c.json(health);
  });
}
