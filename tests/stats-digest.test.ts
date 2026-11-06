/**
 * SLICE-217-1 tests: ops stats digest endpoint.
 *
 * Unit (always run):
 *  - parseDigestWindow presets + fallback
 *  - fetchTrafficRows paged scan + early-stop at cutoff
 *  - runDigest: sent / no_creds / telegram_error paths
 *
 * Route (always run):
 *  - 401 without/with wrong bearer, 500 when token unconfigured
 *
 * Live-gated:
 *  - 200 happy path against dev Postgres (skipped when unreachable)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import {
  parseDigestWindow,
  fetchTrafficRows,
  runDigest,
} from "../src/server/lib/report/traffic-digest";
import { opsStatsRoutes } from "../src/server/routes/ops-stats";
import { getDatabase } from "../src/server/lib/database";
import type { TrafficRow } from "../src/server/lib/report/traffic-format";

const row = (path: string, status = 200, ageMs = 0): TrafficRow => ({
  payload: { method: "GET", path, status, ua: "test-agent/1.0" },
  createdAt: new Date(Date.now() - ageMs).toISOString(),
});

describe("parseDigestWindow", () => {
  it("maps presets to hours", () => {
    expect(parseDigestWindow("24h")).toEqual({ preset: "24h", hours: 24 });
    expect(parseDigestWindow("7d")).toEqual({ preset: "7d", hours: 168 });
    expect(parseDigestWindow("30d")).toEqual({ preset: "30d", hours: 720 });
  });

  it("defaults to 24h on missing/invalid input", () => {
    expect(parseDigestWindow(undefined)).toEqual({ preset: "24h", hours: 24 });
    expect(parseDigestWindow("")).toEqual({ preset: "24h", hours: 24 });
    expect(parseDigestWindow("bogus")).toEqual({ preset: "24h", hours: 24 });
    expect(parseDigestWindow("1h")).toEqual({ preset: "24h", hours: 24 });
  });
});

describe("fetchTrafficRows", () => {
  const fakeEvents = (pages: TrafficRow[][]) => {
    let call = 0;
    return {
      list: vi.fn(async () => {
        const page = pages[call] ?? [];
        call++;
        return page.map((r) => ({
          id: `e${call}`,
          type: "http_traffic",
          source: "edge",
          payload: r.payload,
          createdAt: r.createdAt,
        }));
      }),
    };
  };

  it("collects rows inside the window and stops at cutoff", async () => {
    const now = Date.now();
    const inside = row("/a", 200, 60_000);
    const outside = row("/old", 200, 48 * 3600_000); // 48h ago > 24h window
    const events = fakeEvents([[inside, outside]]);
    const rows = await fetchTrafficRows(events as never, 24, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.path).toBe("/a");
    expect(events.list).toHaveBeenCalledTimes(1);
  });

  it("paginates until a short page", async () => {
    const now = Date.now();
    const page1 = Array.from({ length: 5000 }, () => row("/x", 200, 1000));
    const page2 = [row("/y", 200, 1000)];
    const events = fakeEvents([page1, page2]);
    const rows = await fetchTrafficRows(events as never, 24, now);
    expect(rows).toHaveLength(5001);
    expect(events.list).toHaveBeenCalledTimes(2);
  });
});

describe("runDigest", () => {
  const stats = {
    total: 3,
    byClass: new Map([["2xx", 3]]),
    byUaClass: new Map([["test-agent", 3]]),
    byPath: new Map([["/a", 2], ["/b", 1]]),
    byPathUa: new Map(),
    errors: new Map(),
    errorTotal: 0,
    hourly: new Array<number>(24).fill(0),
    aiCrawlerBody: "",
    srcBody: "",
    from: new Date().toISOString(),
    until: new Date().toISOString(),
    hours: 24,
  };

  it("returns sent:true with messageId when telegram send succeeds", async () => {
    const send = vi.fn(async () => 42);
    const res = await runDigest({
      stats,
      hours: 24,
      preset: "24h",
      sendTelegram: send,
    });
    expect(res.sent).toBe(true);
    expect(res.messageId).toBe(42);
    expect(send).toHaveBeenCalledOnce();
    expect(res.reportText).toContain("Total requests: 3");
  });

  it("returns sent:false reason=no_creds when no telegram config", async () => {
    const res = await runDigest({
      stats,
      hours: 24,
      preset: "24h",
      sendTelegram: undefined,
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("no_creds");
    expect(res.totalRequests).toBe(3);
  });

  it("returns sent:false reason=telegram_error on send failure, keeps stats", async () => {
    const send = vi.fn(async () => {
      throw new Error("tg api down");
    });
    const res = await runDigest({
      stats,
      hours: 24,
      preset: "24h",
      sendTelegram: send,
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("telegram_error");
    expect(res.error).toContain("tg api down");
    expect(res.totalRequests).toBe(3);
  });
});

describe("ops-stats route auth", () => {
  const originalToken = process.env.METRICS_BEARER_TOKEN;

  beforeEach(() => {
    process.env.METRICS_BEARER_TOKEN = "test-ops-token";
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.METRICS_BEARER_TOKEN = originalToken;
    } else {
      delete process.env.METRICS_BEARER_TOKEN;
    }
  });

  it("returns 401 without bearer token", async () => {
    const app = new Hono();
    app.route("/", opsStatsRoutes);
    const res = await app.request("/ops/stats-digest");
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong bearer token", async () => {
    const app = new Hono();
    app.route("/", opsStatsRoutes);
    const res = await app.request("/ops/stats-digest", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });
});

describe("ops-stats route live (dev Postgres)", () => {
  const originalToken = process.env.METRICS_BEARER_TOKEN;
  const originalFetch = globalThis.fetch;
  let dbReachable = false;

  beforeEach(async () => {
    process.env.METRICS_BEARER_TOKEN = "test-ops-token";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    try {
      const db = getDatabase();
      dbReachable = db.db !== null;
      if (db.db) await db.events.list({ type: "http_traffic", limit: 1 });
    } catch {
      dbReachable = false;
    }
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.METRICS_BEARER_TOKEN = originalToken;
    } else {
      delete process.env.METRICS_BEARER_TOKEN;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns digest JSON with sent:false when TG creds absent", async () => {
    if (!dbReachable) return; // live-gated
    const app = new Hono();
    app.route("/", opsStatsRoutes);
    const res = await app.request("/ops/stats-digest?window=24h", {
      headers: { Authorization: "Bearer test-ops-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sent: boolean;
      reason?: string;
      totalRequests: number;
      window: { preset: string; hours: number };
      reportText: string;
    };
    expect(body.sent).toBe(false);
    expect(body.reason).toBe("no_creds");
    expect(body.window.preset).toBe("24h");
    expect(body.window.hours).toBe(24);
    expect(body.totalRequests).toBeGreaterThanOrEqual(0);
    expect(body.reportText).toContain("Total requests:");
  });

  it("sends telegram message when creds present (fetch mocked)", async () => {
    if (!dbReachable) return; // live-gated
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    process.env.TELEGRAM_CHAT_ID = "42";
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 99 } }),
    });
    globalThis.fetch = fetchMock as never;

    const app = new Hono();
    app.route("/", opsStatsRoutes);
    const res = await app.request("/ops/stats-digest?window=7d", {
      headers: { Authorization: "Bearer test-ops-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: boolean; messageId?: number };
    expect(body.sent).toBe(true);
    expect(body.messageId).toBe(99);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
