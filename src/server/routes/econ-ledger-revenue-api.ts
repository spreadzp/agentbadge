/**
 * SLICE-242-9 (D-242-14): GET /api/ledger/revenue?days=N — ops revenue
 * readout: "сколько заработали" по дням и по endpoint'ам.
 *
 * Source of truth: econ-ledger `pay` legs (authoritative settled
 * amounts). Live aggregation in-route — no @agentbadge/database
 * package changes (D-242-14).
 *
 * Mechanics: listByAgent(PAY_TO) pages (newest-first, beforeLedgerSeq
 * cursor) → filter kind="pay" ∧ counterparty=PAY_TO ∧ at >= since →
 * GROUP BY day/endpoint in JS. Cap 10k scanned rows → truncated flag.
 * PAY_TO = X402_PAY_TO ?? CIRCLE_SELLER_ADDRESS.
 *
 * Auth: opsBearerAuth() (same as /api/payments/health); ledgerLimiter
 * 60 req/min like sibling ledger routes. DATABASE_ENABLED=false →
 * honest no_data envelope, never fabricated zeros-without-flag.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Database } from "@agentbadge/database";
import { getDatabase } from "../lib/database";
import { createRateLimiter } from "../middleware/rate-limit";
import { opsBearerAuth } from "../middleware/ops-auth";
import { errJson } from "../lib/econ-ledger/api-utils";
import {
  aggregatePayLegs,
  collectPayLegs,
  revenuePayTo,
} from "../lib/report/revenue-aggregate";

const ledgerLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

const DAY_MS = 86_400_000;

export interface RevenueApiDeps {
  /** Injectable for tests; prod default = getDatabase(). */
  getDb?: () => Database;
  /** Treasury address source; prod default = env. */
  payTo?: () => string | undefined;
  /** Clock injection for window-boundary tests. */
  now?: () => number;
}

export function createRevenueRoutes(deps: RevenueApiDeps = {}): Hono {
  const getDb = deps.getDb ?? getDatabase;
  const getPayTo = deps.payTo ?? revenuePayTo;
  const now = deps.now ?? Date.now;
  const app = new Hono();

  app.get(
    "/api/ledger/revenue",
    opsBearerAuth(),
    describeRoute({
      tags: ["Ledger"],
      summary: "Revenue rollup: settled pay legs by day and endpoint",
      description:
        "Ops-only (METRICS_BEARER_TOKEN). Aggregates econ-ledger pay legs " +
        "to the configured payTo over the last N days. Endpoint without " +
        "payload.endpoint falls into the \"unknown\" bucket. " +
        "DATABASE_ENABLED=false → no_data envelope.",
      responses: {
        200: { description: "Revenue rollup { total, byDay, byEndpoint }" },
        400: { description: "Invalid days parameter" },
        401: { description: "Missing/wrong bearer" },
        429: { description: "Rate limited" },
        500: { description: "Pay-to or ledger unavailable" },
      },
    }),
    async (c) => {
      const rl = await ledgerLimiter(c, async () => { });
      if (rl) return rl;

      const daysRaw = c.req.query("days");
      const days = daysRaw === undefined ? 30 : Number(daysRaw);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return errJson(c, 400, "invalid_id", "days must be an integer 1..365");
      }

      const db = getDb();
      const to = new Date(now()).toISOString();
      const from = new Date(now() - days * DAY_MS).toISOString();
      const window = { from, to, days };

      if (db.db === null) {
        return c.json({
          payTo: null,
          window,
          total: { count: 0, usdc: "0" },
          byDay: [],
          byEndpoint: [],
          error: {
            code: "no_data",
            message: "ledger disabled (DATABASE_ENABLED=false)",
          },
        });
      }

      const payTo = getPayTo();
      if (!payTo) {
        return errJson(
          c,
          500,
          "unavailable",
          "X402_PAY_TO / CIRCLE_SELLER_ADDRESS not configured",
        );
      }
      const since = new Date(now() - days * DAY_MS).toISOString();

      try {
        const { rows, truncated } = await collectPayLegs(db.econLedger, {
          payTo,
          since,
        });
        const rollup = aggregatePayLegs(rows, { payTo, since });
        return c.json({
          payTo,
          window,
          total: rollup.total,
          byDay: rollup.byDay,
          byEndpoint: rollup.byEndpoint,
          ...(truncated ? { truncated: true } : {}),
        });
      } catch (e) {
        return errJson(c, 500, "unavailable", `revenue read failed: ${String(e)}`);
      }
    },
  );

  return app;
}

/** Prod singleton — mounts in registerCoreRoutes. */
export const econLedgerRevenueRoutes = createRevenueRoutes();
