/**
 * GET /ops/stats-digest — on-demand compressed traffic stats → Telegram.
 *
 * EPIC-217 / SLICE-217-1. Ops-only (opsBearerAuth, METRICS_BEARER_TOKEN —
 * same channel as /metrics). Aggregates `http_traffic` Event rows over
 * ?window=24h|7d|30d (default 24h) via the SLICE-203-13 pipeline and sends
 * the HTML digest through lib/notify/telegram.ts.
 *
 * Response always carries the JSON digest (sent flag + stats + text
 * report) so the endpoint is useful even without Telegram creds.
 * Degraded modes: db disabled → 503 telemetry_unavailable; TG creds
 * missing → 200 {sent:false, reason:"no_creds"}; TG API failure →
 * 200 {sent:false, reason:"telegram_error"} (stats not lost).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { resolver } from "hono-openapi";
import { opsBearerAuth } from "../../middleware/ops-auth";
import type { PrismaDb, Store } from "@agentbadge/database";
import { getDatabase } from "../../lib/database";
import {
  sendTelegramMessage,
  telegramFromEnv,
} from "../../lib/notify/telegram";
import { collectStats } from "../../lib/report/traffic-format";
import { collectBusinessStats } from "../../lib/report/business-stats";
import { revenuePayTo } from "../../lib/report/revenue-aggregate";
import { KeyedDedupeCache, sleep } from "../../lib/report/digest-budget";
import {
  fetchTrafficRows,
  parseDigestWindow,
  runDigest,
  type DigestResponse,
} from "../../lib/report/traffic-digest";

export const opsStatsRoutes = new Hono();

/** SLICE-234-3 budgets: 60s replay window, 25s overall soft-cap.
 *  (Fly proxy ~60s; TG send has its own 10s race inside runDigest.) */
const DIGEST_CACHE_TTL_MS = 60_000;
const DIGEST_BUDGET_MS = 25_000;
const digestCache = new KeyedDedupeCache<DigestResponse>(DIGEST_CACHE_TTL_MS);

/** 200 response when the compute pipeline exceeds DIGEST_BUDGET_MS —
 *  carries valid shape with zeroed stats, never a bare proxy timeout. */
const partialDigest = (
  preset: DigestResponse["window"]["preset"],
  hours: number,
): DigestResponse => {
  const until = new Date();
  return {
    sent: false,
    reason: "timeout",
    partial: true,
    error: `stats-digest exceeded ${DIGEST_BUDGET_MS}ms budget`,
    window: {
      preset,
      hours,
      from: new Date(until.getTime() - hours * 3600_000).toISOString(),
      until: until.toISOString(),
    },
    totalRequests: 0,
    errorTotal: 0,
    topPaths: [],
    business: null,
    reportText: `stats-digest ${preset}: exceeded ${DIGEST_BUDGET_MS}ms budget — partial response`,
  };
};

/** The full digest pipeline — fetch + stats + business + TG send.
 *  Rejects only on store failure (→ 503); TG errors degrade inside
 *  runDigest to sent:false. */
async function computeDigest(
  prisma: PrismaDb,
  events: Pick<Store, "list">,
  preset: DigestResponse["window"]["preset"],
  hours: number,
): Promise<DigestResponse> {
  const rows = await fetchTrafficRows(events, hours);
  const stats = collectStats(rows, hours);

  // SLICE-217-2: business aggregates over the same window. Failure
  // degrades to null — never fails the traffic digest.
  const business = await collectBusinessStats(
    prisma,
    new Date(Date.now() - hours * 3600_000).toISOString(),
    { payTo: revenuePayTo() }, // 242-11: x402Revenue section
  ).catch(() => null);

  const tg = telegramFromEnv();
  return runDigest({
    stats,
    hours,
    preset,
    business,
    sendTelegram: tg ? (text) => sendTelegramMessage(text, tg) : undefined,
  });
}

const digestResponseSchema = z.object({
  sent: z.boolean(),
  reason: z.enum(["no_creds", "telegram_error", "timeout"]).optional(),
  error: z.string().optional(),
  messageId: z.number().optional(),
  partial: z.boolean().optional(),
  window: z.object({
    preset: z.enum(["24h", "7d", "30d"]),
    hours: z.number().int(),
    from: z.string(),
    until: z.string(),
  }),
  totalRequests: z.number().int(),
  errorTotal: z.number().int(),
  topPaths: z.array(z.tuple([z.string(), z.number().int()])),
  business: z.unknown().nullable().optional(),
  reportText: z.string(),
});

const telemetryUnavailable = (message: string) =>
  ({
    error: {
      code: "telemetry_unavailable",
      message,
    },
  }) as const;

opsStatsRoutes.get(
  "/ops/stats-digest",
  describeRoute({
    tags: ["Ops"],
    summary: "Traffic stats digest → Telegram (ops bearer auth)",
    description:
      "Aggregates http_traffic events over ?window=24h|7d|30d (default 24h) and sends a compressed HTML digest to the operator Telegram chat. JSON response always includes the digest (sent flag, window, totals, top paths, text report). Requires METRICS_BEARER_TOKEN bearer.",
    responses: {
      200: {
        description: "Digest assembled; sent=true when Telegram accepted",
        content: {
          "application/json": {
            schema: resolver(digestResponseSchema),
          },
        },
      },
      401: { description: "Missing/invalid bearer token" },
      503: {
        description: "Telemetry unavailable (database disabled or unreachable)",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            ),
          },
        },
      },
    },
  }),
  opsBearerAuth(),
  async (c) => {
    const db = getDatabase();
    if (!db.db) {
      return c.json(
        telemetryUnavailable(
          "Traffic telemetry requires the Postgres event store (DATABASE_ENABLED).",
        ),
        503,
      );
    }

    const { preset, hours } = parseDigestWindow(c.req.query("window"));

    // SLICE-234-3: dedupe + 60s cache around the whole pipeline.
    // Concurrent same-window requests share one compute; a compute
    // exceeding DIGEST_BUDGET_MS yields a partial 200 (still cached —
    // avoids recompute storms on a hot window).
    let outcome;
    try {
      outcome = await digestCache.get(preset, () =>
        Promise.race<DigestResponse>([
          computeDigest(db.db!, db.events, preset, hours),
          sleep(DIGEST_BUDGET_MS).then(() => partialDigest(preset, hours)),
        ]),
      );
    } catch {
      return c.json(
        telemetryUnavailable(
          "Traffic telemetry store is not reachable from this deployment.",
        ),
        503,
      );
    }
    c.header("X-Cache", outcome.state);
    return c.json(outcome.res, 200);
  },
);
