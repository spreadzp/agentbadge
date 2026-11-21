/**
 * SLICE-234-39: telemetry-poison — control-chars (\x00–\x1f,\x7f) в
 * path/UA/referer попадали в event.payload и ломали `->>`-аналитику
 * Postgres (poisoned-строки уже в проде). Фикс — strip при сборке
 * payload в traffic-log middleware.
 *
 * NB: app.request() не может доставить %00-путь до middleware (Hono
 * отвечает 404 на этапе роутинга), поэтому stripCtl тестируется
 * юнитом, а интеграция — на обычном пути через spy на events.create.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { trafficLog, stripCtl } from "../../src/server/middleware/traffic-log";
import { getDatabase, resetDatabaseForTests } from "../../src/server/lib/database";
import { resetConfigCache } from "../../src/config/env/core";

describe("stripCtl (SLICE-234-39)", () => {
  it("стрипает весь control-диапазон включая NUL/CR/LF/TAB/DEL", () => {
    expect(stripCtl("/api/x\x00y\x01z")).toBe("/api/xyz");
    expect(stripCtl("/a\x0ab\x0dc\x09d\x1fe\x7ff")).toBe("/abcdef");
    expect(stripCtl("/clean/path")).toBe("/clean/path");
    expect(stripCtl(null)).toBeNull();
    expect(stripCtl(undefined)).toBeNull();
  });
});

describe("traffic-log payload (integration)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // durable-path включён: db.db != null → middleware пишет событие
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL = "postgresql://127.0.0.1:1/probe-test";
    resetConfigCache();
    resetDatabaseForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  it("событие пишется с ожидаемыми полями payload", async () => {
    const db = getDatabase();
    expect(db.db).not.toBeNull();
    const spy = vi
      .spyOn(db.events, "create")
      .mockResolvedValue({} as Awaited<ReturnType<typeof db.events.create>>);

    const app = new Hono();
    app.use(trafficLog);
    app.get("/api/x", (c) => c.text("ok"));

    const res = await app.request("/api/x", {
      headers: { "user-agent": "AgentBadge-ProbeBot/0.1" },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20)); // fire-and-forget create()

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(arg.payload.method).toBe("GET");
    expect(arg.payload.path).toBe("/api/x");
    expect(arg.payload.status).toBe(200);
    expect(arg.payload.ua).toBe("AgentBadge-ProbeBot/0.1");
  });
});
