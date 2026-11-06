/**
 * GET /api/meta/traffic-report — live request telemetry, machine-readable.
 *
 * Aggregates `http_traffic` Event rows written by the traffic-log edge
 * middleware over a ?hours= window (default 24, max 168) into the same
 * stats the daily email/Telegram report uses (lib/report/traffic-format).
 * Evidence endpoint for the C40 article's traffic claims — agents can
 * curl it and verify the bot-traffic numbers themselves.
 *
 * Separate file from meta.ts: meta.ts is at the 300-line eslint limit.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { resolver } from "hono-openapi";
import { getDatabase } from "../lib/database";
import {
  aiCrawlerStats,
  collectStats,
  type TrafficRow,
} from "../lib/report/traffic-format";
import { srcAttributionStats } from "../lib/report/src-attribution-report";

export const metaTrafficRoutes = new Hono();

const pathCountSchema = z.object({
  path: z.string(),
  count: z.number().int(),
});

const trafficReportSchema = z.object({
  generated_at: z.string(),
  window: z.object({
    from: z.string(),
    until: z.string(),
    hours: z.number().int(),
  }),
  source: z.string(),
  total_requests: z.number().int(),
  status_classes: z.array(
    z.object({ class: z.string(), count: z.number().int() }),
  ),
  clients: z.array(
    z.object({ ua_class: z.string(), count: z.number().int() }),
  ),
  top_paths: z.array(pathCountSchema),
  top_client_paths: z.array(
    z.object({
      client: z.string(),
      path: z.string(),
      count: z.number().int(),
    }),
  ),
  ai_crawlers: z.array(
    z.object({
      crawler: z.string(),
      hits: z.number().int(),
      top_paths: z.array(pathCountSchema),
    }),
  ),
  src_attribution: z.array(
    z.object({
      src: z.string(),
      hits: z.number().int(),
      conversions: z.number().int(),
      top_paths: z.array(pathCountSchema),
    }),
  ),
  errors: z.object({
    total: z.number().int(),
    top: z.array(
      z.object({
        status: z.number().int(),
        method: z.string(),
        path: z.string(),
        count: z.number().int(),
      }),
    ),
  }),
  hourly_utc: z.array(
    z.object({ hour: z.number().int(), count: z.number().int() }),
  ),
});

const topN = (m: Map<string, number>, n: number): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const telemetryUnavailable = (message: string) =>
  ({
    error: {
      code: "telemetry_unavailable",
      message,
    },
  }) as const;

metaTrafficRoutes.get(
  "/api/meta/traffic-report",
  describeRoute({
    tags: ["Meta"],
    summary: "Traffic report — live request telemetry, machine-readable",
    description:
      "Aggregates http_traffic events collected by the edge middleware over the last N hours (?hours=, default 24, max 168): totals, status classes, top clients by UA class, top paths, AI-crawler hits, ?src registry attribution with register conversions, errors and per-UTC-hour distribution. Evidence endpoint for traffic claims.",
    responses: {
      200: {
        description: "Aggregated traffic report JSON",
        content: {
          "application/json": {
            schema: resolver(trafficReportSchema),
          },
        },
      },
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

    const raw = Number(c.req.query("hours") ?? "24");
    const hours = Math.min(Math.max(Math.trunc(raw) || 24, 1), 168);
    const cutoff = Date.now() - hours * 3600_000;

    // Paged scan — events.list is newest-first, so we can early-stop once
    // we cross the cutoff (rows are createdAt-desc). Same loop as
    // scripts/traffic-report.ts.
    const PAGE = 5000;
    const rows: TrafficRow[] = [];
    let done = false;
    try {
      for (let offset = 0; !done; offset += PAGE) {
        const page = await db.events.list({
          type: "http_traffic",
          limit: PAGE,
          offset,
        });
        if (page.length === 0) break;
        for (const e of page) {
          if (Date.parse(e.createdAt) < cutoff) {
            done = true;
            break;
          }
          rows.push({ payload: e.payload ?? {}, createdAt: e.createdAt });
        }
        if (page.length < PAGE) break;
      }
    } catch {
      return c.json(
        telemetryUnavailable(
          "Traffic telemetry store is not reachable from this deployment.",
        ),
        503,
      );
    }

    const stats = collectStats(rows, hours);

    return c.json(
      {
        generated_at: new Date().toISOString(),
        window: { from: stats.from, until: stats.until, hours: stats.hours },
        source: "http_traffic events (edge middleware)",
        total_requests: stats.total,
        status_classes: topN(stats.byClass, 10).map(([klass, count]) => ({
          class: klass,
          count,
        })),
        clients: topN(stats.byUaClass, 15).map(([ua_class, count]) => ({
          ua_class,
          count,
        })),
        top_paths: topN(stats.byPath, 20).map(([path, count]) => ({
          path,
          count,
        })),
        top_client_paths: topN(stats.byPathUa, 15).map(([key, count]) => {
          const i = key.indexOf(" → ");
          return {
            client: i >= 0 ? key.slice(0, i) : key,
            path: i >= 0 ? key.slice(i + 3) : "?",
            count,
          };
        }),
        ai_crawlers: aiCrawlerStats(rows).map((s) => ({
          crawler: s.crawler,
          hits: s.hits,
          top_paths: s.topPaths.map(([path, count]) => ({ path, count })),
        })),
        src_attribution: srcAttributionStats(rows).map((s) => ({
          src: s.src,
          hits: s.hits,
          conversions: s.conversions,
          top_paths: s.topPaths.map(([path, count]) => ({ path, count })),
        })),
        errors: {
          total: stats.errorTotal,
          top: topN(stats.errors, 20).map(([key, count]) => {
            const m = /^(\d{3}) (\S+) (.*)$/.exec(key);
            return {
              status: Number(m?.[1] ?? 0),
              method: m?.[2] ?? "GET",
              path: m?.[3] ?? key,
              count,
            };
          }),
        },
        hourly_utc: stats.hourly.map((count, hour) => ({ hour, count })),
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  },
);
