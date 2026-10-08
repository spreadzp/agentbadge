/**
 * SLICE-191-9: Arc anchoring — verdict hash determinism, async retry
 * queue (Arc RPC down → feed alive, anchor catches up), alert-transition
 * dedup, and the /api/fx-delta/verify/:id route.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  verdictOf,
  verdictCanonical,
  verdictHash,
  AnchorQueue,
  createAlertAnchor,
  type FxDeltaVerdict,
} from "../src/server/lib/fx-delta/anchor";
import {
  setFxDeltaRuntime,
  resetFxDeltaRuntime,
  setFxDeltaAnchorQueue,
  resetFxDeltaAnchor,
  type FxDeltaView,
} from "../src/server/lib/fx-delta";
import { fxDeltaRoutes } from "../src/server/routes/fx-delta-api";
import { fxDeltaVerifyRoutes } from "../src/server/routes/fx-delta-verify";

const view = (over: Partial<FxDeltaView> = {}): FxDeltaView => ({
  corridor: "USDT-NGN",
  fiat: "NGN",
  chainRate: 1520.5,
  fxRefRate: 1510.2,
  deltaPct: 0.682,
  phase: "open",
  frozen: false,
  stale: false,
  thin: false,
  inAlert: true,
  oracleLagPct: 0.03,
  tvlUsd: 197110,
  lastUpdateMs: 1000,
  ...over,
});

const verdict = (over: Partial<FxDeltaVerdict> = {}): FxDeltaVerdict => ({
  corridor: "USDT-NGN",
  deltaPct: 0.682,
  onchainPrice: 1520.5,
  fxRef: 1510.2,
  phase: "open",
  thin: false,
  tsMs: 1000,
  ...over,
});

function runtime(views: FxDeltaView[]) {
  return {
    engine: {
      getAll: () => views,
      getView: (c: string) => views.find((v) => v.corridor === c) ?? null,
      getHistory: () => [],
      getEvents: () => [],
    },
    corridors: [],
    sources: () => ({
      uniswap: { connected: true, lastTickMs: 1 },
      mento: { connected: true, lastTickMs: 1 },
      fxRef: { connected: true, lastTickMs: 1 },
    }),
    startedAtMs: 0,
  };
}

describe("verdict hash", () => {
  it("canonical JSON is deterministic regardless of key order", () => {
    const a = { ...verdict() };
    const b = Object.fromEntries(
      Object.entries(verdict()).reverse(),
    ) as FxDeltaVerdict;
    expect(verdictCanonical(a)).toBe(verdictCanonical(b));
    expect(verdictHash(a)).toBe(verdictHash(b));
    expect(verdictHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verdictOf maps the engine view", () => {
    const v = verdictOf(view());
    expect(v.corridor).toBe("USDT-NGN");
    expect(v.onchainPrice).toBe(1520.5);
    expect(v.fxRef).toBe(1510.2);
    expect(v.tsMs).toBe(1000);
  });
});

describe("AnchorQueue (AC3: Arc down → retry)", () => {
  it("retries a failed write until success — feed never blocks", async () => {
    let calls = 0;
    const q = new AnchorQueue({
      writer: async () => {
        calls++;
        if (calls < 3) throw new Error("arc rpc down");
        return "0xtx";
      },
      now: () => 1,
    });
    const rec = q.enqueue(verdict());
    // enqueue fires flush — first attempt already failed
    await q.flush();
    expect(rec.status).toBe("pending");
    expect(rec.attempts).toBeGreaterThanOrEqual(2);

    await q.flush();
    expect(rec.status).toBe("anchored");
    expect(rec.txHash).toBe("0xtx");
  });

  it("dead after maxAttempts", async () => {
    const q = new AnchorQueue({
      writer: async () => {
        throw new Error("always");
      },
      maxAttempts: 2,
      now: () => 1,
    });
    const rec = q.enqueue(verdict());
    await q.flush();
    await q.flush();
    await q.flush();
    expect(rec.status).toBe("dead");
  });

  it("enqueue dedups identical verdicts", () => {
    const q = new AnchorQueue({
      writer: async () => "0xok",
      now: () => 1,
    });
    const a = q.enqueue(verdict());
    const b = q.enqueue(verdict());
    expect(a.id).toBe(b.id);
    expect(q.size()).toBe(1);
  });
});

describe("createAlertAnchor", () => {
  it("enqueues only on false→true transition", async () => {
    const sent: string[] = [];
    const q = new AnchorQueue({
      writer: async (p) => {
        sent.push(p);
        return "0xtx";
      },
      now: () => 1,
    });
    const engine = { getAll: () => [view()] };
    const watcher = createAlertAnchor(engine, q);

    await watcher.tick(); // flip → enqueue
    await watcher.tick(); // still inAlert — no dup
    expect(q.size()).toBe(1);

    // drop out of alert then re-enter → second verdict
    const engine2 = { getAll: () => [view({ inAlert: false })] };
    createAlertAnchor(engine2, q).tick();
    // reuse same watcher state — simulate flip back
    const w2 = createAlertAnchor(
      { getAll: () => [view({ lastUpdateMs: 2000 })] },
      q,
    );
    w2.tick();
    expect(q.size()).toBe(2);
  });
});

describe("GET /api/fx-delta/verify/:id", () => {
  const app = new Hono()
    .route("/", fxDeltaRoutes)
    .route("/", fxDeltaVerifyRoutes);

  it("200 + hashMatch for anchored verdict", async () => {
    setFxDeltaRuntime(runtime([view()]));
    const q = new AnchorQueue({
      writer: async () => "0xanchor",
      now: () => 1,
    });
    setFxDeltaAnchorQueue(q);
    const rec = q.enqueue(verdict());
    await q.flush();

    const res = await app.request(`/api/fx-delta/verify/${rec.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("anchored");
    expect(body.txHash).toBe("0xanchor");
    expect(body.hashMatch).toBe(true);
    expect(body.sha256).toBe(rec.hash);
    expect(body.explorer).toContain("0xanchor");

    resetFxDeltaAnchor();
    resetFxDeltaRuntime();
  });

  it("404 for unknown id", async () => {
    setFxDeltaRuntime(runtime([view()]));
    const res = await app.request("/api/fx-delta/verify/nope");
    expect(res.status).toBe(404);
    resetFxDeltaRuntime();
  });
});
