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
import {
  fromMicros,
  toMicros,
  type Database,
  type EconEventStored,
} from "@agentbadge/database";
import { getDatabase } from "../lib/database";
import { createRateLimiter } from "../middleware/rate-limit";
import { opsBearerAuth } from "../middleware/ops-auth";
import { errJson } from "../lib/econ-ledger/api-utils";

const ledgerLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

const PAGE_SIZE = 500;
const SCAN_CAP = 10_000;
const DAY_MS = 86_400_000;
const UNKNOWN_ENDPOINT = "unknown";

export interface RevenueApiDeps {
  /** Injectable for tests; prod default = getDatabase(). */
  getDb?: () => Database;
  /** Treasury address source; prod default = env. */
  payTo?: () => string | undefined;
  /** Clock injection for window-boundary tests. */
  now?: () => number;
}

const envPayTo = () =>
  process.env.X402_PAY_TO ?? process.env.CIRCLE_SELLER_ADDRESS ?? undefined;

interface Bucket {
  count: number;
  micros: bigint;
}

export function createRevenueRoutes(deps: RevenueApiDeps = {}): Hono {
  const getDb = deps.getDb ?? getDatabase;
  const getPayTo = deps.payTo ?? envPayTo;
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
      const payToLc = payTo.toLowerCase();
      const since = new Date(now() - days * DAY_MS).toISOString();

      try {
        const inWindow: EconEventStored[] = [];
        let truncated = false;
        let cursor: bigint | undefined;
        let scanned = 0;

        for (; ;) {
          const page = await db.econLedger.listByAgent(payToLc, {
            ...(cursor !== undefined ? { beforeLedgerSeq: cursor } : {}),
            limit: PAGE_SIZE,
          });
          if (page.length === 0) break;
          scanned += page.length;
          cursor = page[page.length - 1]!.ledgerSeq;

          let pageMaxAt = "";
          for (const row of page) {
            const e = row.event;
            if (e.at > pageMaxAt) pageMaxAt = e.at;
            if (
              e.kind !== "pay" ||
              e.counterparty?.toLowerCase() !== payToLc ||
              e.at < since
            ) {
              continue;
            }
            inWindow.push(row);
          }

          if (scanned >= SCAN_CAP) {
            truncated = true;
            break;
          }
          // Newest-first: a page entirely older than the window means
          // nothing in-window can follow (append order ~ event time).
          if (pageMaxAt < since) break;
          if (page.length < PAGE_SIZE) break;
        }

        const total: Bucket = { count: 0, micros: 0n };
        const byDay = new Map<string, Bucket>();
        const byEndpoint = new Map<string, Bucket>();
        const bump = (m: Map<string, Bucket>, k: string, micros: bigint) => {
          const b = m.get(k) ?? { count: 0, micros: 0n };
          b.count++;
          b.micros += micros;
          m.set(k, b);
        };

        for (const row of inWindow) {
          const e = row.event;
          const micros = toMicros(e.amountUsdc);
          total.count++;
          total.micros += micros;
          bump(byDay, e.at.slice(0, 10), micros);
          const endpoint =
            (e.payload as { endpoint?: string } | undefined)?.endpoint ??
            UNKNOWN_ENDPOINT;
          bump(byEndpoint, endpoint, micros);
        }

        const fmt = (b: Bucket) => ({
          count: b.count,
          usdc: fromMicros(b.micros),
        });

        return c.json({
          payTo,
          window,
          total: fmt(total),
          byDay: [...byDay.entries()]
            .map(([day, b]) => ({ day, ...fmt(b) }))
            .sort((a, b2) => (a.day < b2.day ? -1 : 1)),
          byEndpoint: [...byEndpoint.entries()]
            .sort(
              ([, a], [, b]) =>
                b.count - a.count ||
                (b.micros > a.micros ? 1 : b.micros < a.micros ? -1 : 0),
            )
            .map(([endpoint, b]) => ({ endpoint, ...fmt(b) })),
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
