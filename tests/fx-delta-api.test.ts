/**
 * SLICE-191-5: /api/fx-delta/* — free tier, fields, health.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  fxDeltaRoutes,
  resetFxDeltaFreeTier,
} from "../src/server/routes/fx-delta-api";
import {
  setFxDeltaRuntime,
  resetFxDeltaRuntime,
  type FxDeltaRuntime,
} from "../src/server/lib/fx-delta";

const VIEW = {
  corridor: "wARS",
  fiat: "ARS",
  chainRate: 1520,
  fxRefRate: 1500,
  deltaPct: 1.3333,
  phase: "weekend",
  frozen: true,
  stale: false,
  thin: false,
  inAlert: true,
  oracleLagPct: 0.0021,
  tvlUsd: 86_876,
  lastUpdateMs: 999_999,
};

function fakeRuntime(): FxDeltaRuntime {
  return {
    engine: {
      getAll: () => [VIEW],
      getView: (c: string) => (c === "wARS" ? VIEW : null),
      getHistory: () => [{ t: 1, deltaPct: 1.2 }],
      getEvents: () => [{ type: "pool/paused", corridor: "wARS", atMs: 1 }],
    },
    corridors: [
      {
        symbol: "wARS",
        fiat: "ARS",
        token: "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d",
        decimals: 18,
        tracks: ["latam"],
      },
    ],
    sources: () => ({
      uniswap: { connected: true, lastTickMs: Date.now() },
      mento: { connected: true, lastTickMs: Date.now() },
      fxRef: { connected: false, lastTickMs: 0 },
    }),
    startedAtMs: Date.now() - 60_000,
  };
}

describe("/api/fx-delta", () => {
  let app: Hono;

  beforeEach(() => {
    resetFxDeltaRuntime();
    resetFxDeltaFreeTier();
    app = new Hono();
    app.route("/", fxDeltaRoutes);
  });

  it("503/degraded when engine absent", async () => {
    const snap = await app.request("/api/fx-delta/snapshot");
    expect(snap.status).toBe(503);
    const health = await app.request("/api/fx-delta/health");
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe("degraded");
  });

  it("snapshot returns fields; second request within a minute → 402", async () => {
    setFxDeltaRuntime(fakeRuntime());
    const r1 = await app.request("/api/fx-delta/snapshot");
    expect(r1.status).toBe(200);
    expect(r1.headers.get("Cache-Control")).toContain("max-age=5");
    const body = await r1.json();
    const v = body.corridors[0];
    for (const f of ["corridor", "onchainPrice", "fxRef", "deltaPct", "phase", "frozen", "thin", "stale", "oracleLagPct", "tsMs"]) {
      expect(v).toHaveProperty(f);
    }
    expect(v.frozen).toBe(true);
    expect(v.oracleLagPct).toBe(0.0021);

    const r2 = await app.request("/api/fx-delta/snapshot");
    expect(r2.status).toBe(402);
    expect((await r2.json()).code).toBe("PAYMENT_REQUIRED");
  });

  it("corridors metadata is unlimited and includes token/thin", async () => {
    setFxDeltaRuntime(fakeRuntime());
    const r = await app.request("/api/fx-delta/corridors");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.corridors[0].symbol).toBe("wARS");
    expect(body.corridors[0]).toHaveProperty("token");
    expect(body.corridors[0]).toHaveProperty("thin");
    // free route — repeat is fine
    expect((await app.request("/api/fx-delta/corridors")).status).toBe(200);
  });

  it("/:corridor returns view + history; unknown → 404; over-limit → 402", async () => {
    setFxDeltaRuntime(fakeRuntime());
    const r = await app.request("/api/fx-delta/wARS", {
      headers: { "x-wallet": "0x1111111111111111111111111111111111111111" },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.corridor).toBe("wARS");
    expect(body.history).toHaveLength(1);

    // Unknown corridor, different identity (fresh bucket) → 404
    const r404 = await app.request("/api/fx-delta/nope", {
      headers: { "x-wallet": "0x2222222222222222222222222222222222222222" },
    });
    expect(r404.status).toBe(404);

    // Same wallet, second hit → free tier exceeded → 402
    const r402 = await app.request("/api/fx-delta/wARS", {
      headers: { "x-wallet": "0x1111111111111111111111111111111111111111" },
    });
    expect(r402.status).toBe(402);
  });

  it("health shows per-source status", async () => {
    setFxDeltaRuntime(fakeRuntime());
    const r = await app.request("/api/fx-delta/health");
    const body = await r.json();
    expect(body.status).toBe("ok");
    expect(body.sources.uniswap.connected).toBe(true);
    expect(body.sources.fxRef.connected).toBe(false);
    expect(body.sources.fxRef.ageSec).toBeNull();
  });
});
