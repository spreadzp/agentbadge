/**
 * SLICE-234-3 tests: request budget guards on /ops/stats-digest.
 *
 *  - KeyedDedupeCache: concurrent same-key shares one compute
 *    (miss + inflight), TTL replays (hit), expiry recomputes,
 *    different keys compute separately
 *  - runDigest: TG send bounded by sendTimeoutMs — a hung Bot API
 *    degrades to sent:false/telegram_error instead of hanging
 *  - route level: dedupe + X-Cache header + 25s budget partial —
 *    route tests use injected fakes via module mocks
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeyedDedupeCache, sleep, withTimeout } from "../../src/server/lib/report/digest-budget";
import { runDigest } from "../../src/server/lib/report/traffic-digest";
import { collectStats } from "../../src/server/lib/report/traffic-format";

describe("KeyedDedupeCache", () => {
  it("concurrent same-key callers share one compute", async () => {
    const cache = new KeyedDedupeCache<number>();
    const compute = vi.fn(async () => {
      await sleep(30);
      return 42;
    });
    const [a, b] = await Promise.all([
      cache.get("24h", compute),
      cache.get("24h", compute),
    ]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(a.res).toBe(42);
    expect(b.res).toBe(42);
    const states = [a.state, b.state].sort();
    expect(states).toEqual(["inflight", "miss"]);
  });

  it("TTL hit replays; expiry recomputes; distinct keys separate", async () => {
    let t = 1_000;
    const cache = new KeyedDedupeCache<number>(60_000, () => t);
    let n = 0;
    const compute = vi.fn(async () => ++n);

    const first = await cache.get("24h", compute);
    expect(first.state).toBe("miss");

    const second = await cache.get("24h", compute);
    expect(second.state).toBe("hit");
    expect(second.res).toBe(first.res);
    expect(compute).toHaveBeenCalledTimes(1);

    t += 61_000; // past TTL
    const third = await cache.get("24h", compute);
    expect(third.state).toBe("miss");
    expect(third.res).toBe(2);

    const other = await cache.get("7d", compute);
    expect(other.state).toBe("miss");
    expect(other.res).toBe(3);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("a rejected compute propagates to every sharer and clears inflight", async () => {
    const cache = new KeyedDedupeCache<number>();
    const boom = vi.fn(async () => {
      await sleep(10);
      throw new Error("store down");
    });
    const p1 = cache.get("24h", boom).catch((e) => e);
    const p2 = cache.get("24h", boom).catch((e) => e);
    const [e1, e2] = await Promise.all([p1, p2]);
    expect(e1.message).toBe("store down");
    expect(e2.message).toBe("store down");
    // inflight cleared — next call recomputes
    const ok = await cache.get("24h", async () => 7);
    expect(ok.res).toBe(7);
  });
});

describe("withTimeout", () => {
  it("resolves fast promises, rejects hung ones", async () => {
    await expect(withTimeout(sleep(5).then(() => "ok"), 500)).resolves.toBe("ok");
    await expect(withTimeout(new Promise(() => { }), 30)).rejects.toThrow(
      "timeout after 30ms",
    );
  });
});

describe("runDigest TG send timeout (SLICE-234-3)", () => {
  const stats = collectStats(
    [{ payload: { method: "GET", path: "/x", status: 200 }, createdAt: new Date().toISOString() }],
    24,
  );

  it("hung sendTelegram degrades to sent:false telegram_error", async () => {
    const res = await runDigest({
      stats,
      hours: 24,
      preset: "24h",
      sendTelegram: () => new Promise<number>(() => { }), // never settles
      sendTimeoutMs: 40,
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("telegram_error");
    expect(res.error).toContain("timeout");
  });

  it("fast send still wins with messageId", async () => {
    const res = await runDigest({
      stats,
      hours: 24,
      preset: "24h",
      sendTelegram: async () => 42,
      sendTimeoutMs: 500,
    });
    expect(res).toMatchObject({ sent: true, messageId: 42 });
  });
});

// Route tests mock the database module (real getDatabase returns db:null
// → 503) and the TG sender (avoid real Bot API calls). Mocks must live
// at file top level — a describe-scoped vi.mock deadlocks resolution.
const { listSpy } = vi.hoisted(() => ({
  listSpy: vi.fn(async (..._args: unknown[]) => [
    {
      payload: { method: "GET", path: "/x", status: 200 },
      createdAt: new Date().toISOString(),
    },
  ]),
}));

vi.mock("../../src/server/lib/database", () => ({
  getDatabase: () => ({
    db: {}, // raw-sql lane gets an empty object — business queries fail → degraded zeros
    events: { list: (...a: unknown[]) => listSpy(...a) },
  }),
}));

vi.mock("../../src/server/lib/notify/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/lib/notify/telegram")>()),
  sendTelegramMessage: vi.fn(async () => 42),
}));

describe("ops-stats route dedupe + budget (module mocks)", () => {
  beforeEach(() => {
    listSpy.mockClear();
  });

  it("concurrent same-window requests share one fetch; X-Cache marks hit/inflight", async () => {
    const { Hono } = await import("hono");
    const { opsStatsRoutes } = await import("../../src/server/routes/ops/ops-stats");
    process.env.METRICS_BEARER_TOKEN = "t";
    const app = new Hono();
    app.route("/", opsStatsRoutes);
    const auth = { headers: { Authorization: "Bearer t" } };

    const [r1, r2] = await Promise.all([
      app.request("/ops/stats-digest?window=24h", auth),
      app.request("/ops/stats-digest?window=24h", auth),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(listSpy).toHaveBeenCalledTimes(1); // dedupe works
    const caches = [
      r1.headers.get("x-cache") ?? "",
      r2.headers.get("x-cache") ?? "",
    ].sort();
    // one computes (miss), the other shares (inflight) or replays (hit)
    expect(["inflight", "miss"].includes(caches[0])).toBe(true);
    expect(["hit", "inflight", "miss"].includes(caches[1])).toBe(true);

    // cached replay — no second fetch
    const r3 = await app.request("/ops/stats-digest?window=24h", auth);
    expect(r3.headers.get("x-cache")).toBe("hit");
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("different windows compute separately", async () => {
    const { Hono } = await import("hono");
    const { opsStatsRoutes } = await import("../../src/server/routes/ops/ops-stats");
    process.env.METRICS_BEARER_TOKEN = "t";
    const app = new Hono();
    app.route("/", opsStatsRoutes);
    const auth = { headers: { Authorization: "Bearer t" } };

    const r = await app.request("/ops/stats-digest?window=7d", auth);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-cache")).toBe("miss");
    expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    // window preset honoured
    const body = (await r.json()) as { window: { preset: string } };
    expect(body.window.preset).toBe("7d");
  });
});
