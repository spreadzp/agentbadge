/**
 * Traffic telemetry → Postgres `Event` table (type "http_traffic").
 *
 * Persists every request's method/path/status/duration/UA/referer/IP so
 * daily reports (scripts/traffic-report.ts) can analyse bot traffic,
 * error patterns and crawler reach — the fly-logs buffer only holds
 * ~10 minutes, so the DB is the durable log.
 *
 * Fire-and-forget: the write must never block or fail the request.
 * Skipped entirely when the database is disabled — the in-memory
 * Event store is a Map and would grow unbounded.
 */

import type { MiddlewareHandler } from "hono";
import { normalizeSrc } from "./src-attribution";
import { getDatabase } from "../lib/database";

export const trafficLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();

  try {
    const db = getDatabase();
    if (!db.db) return; // in-memory mode — no durable telemetry

    const forwarded = c.req.header("x-forwarded-for");
    const payload = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
      ua: c.req.header("user-agent") ?? null,
      referer: c.req.header("referer") ?? null,
      ip:
        c.req.header("fly-client-ip") ??
        forwarded?.split(",")[0]?.trim() ??
        null,
      requestId: (c.get("requestId") as string | undefined) ?? null,
      // SLICE-206-12: normalized ?src= for registry attribution +
      // src→registration conversion in traffic-report.
      src: normalizeSrc(c.req.query("src")),
    };

    void db.events
      .create({ type: "http_traffic", source: "edge", payload })
      .catch(() => {});
  } catch {
    // telemetry is best-effort — never break the request path
  }
};
