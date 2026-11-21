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

/** SLICE-234-39: control-chars (NUL и др.) в path/UA/referer отравляют
 *  payload JSONB — `payload->>'path'` падает на всей выборке. Стрипаем.
 *  Экспортируется для тестов (app.request не пропускает %00-пути —
 *  Hono отвечает 404 до middleware; в проде Bun-рантайм их пропускал). */
export const stripCtl = (s: string | null | undefined): string | null =>
  s == null ? null : s.replace(/[\x00-\x1f\x7f]/g, "");

export const trafficLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();

  try {
    const db = getDatabase();
    if (!db.db) return; // in-memory mode — no durable telemetry

    const forwarded = c.req.header("x-forwarded-for");
    const payload = {
      method: c.req.method,
      path: stripCtl(c.req.path) ?? "",
      status: c.res.status,
      durationMs: Date.now() - start,
      ua: stripCtl(c.req.header("user-agent")),
      referer: stripCtl(c.req.header("referer")),
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
