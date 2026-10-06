/**
 * SLICE-160-2 tests — GET /api/payments/health.
 *
 * JSON shape {ok, rails, facilitator, gateway, failures, time},
 * degraded cases, gauge side-effects, METRICS_BEARER_TOKEN auth
 * (same ops gate as /metrics — D4-160).
 */

import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import {
  createMemoryFailureStore,
  recordFailure,
} from "@agentbadge/circle-payments";
import {
  createPaymentsHealthRoutes,
  type FacilitatorHealth,
} from "../src/server/routes/payments-health";
import {
  createFacilitatorProbe,
} from "../src/server/lib/circle-payments-probe";
import {
  createCrosschainPaymentsStore,
  type CrosschainPaymentsStore,
} from "../src/server/lib/crosschain-payments";
import { facilitatorUp, registry } from "../src/server/metrics/payments";

const TOKEN = "test-metrics-token";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

function freshApp(deps: {
  facilitator?: FacilitatorHealth | (() => Promise<FacilitatorHealth>);
  store?: CrosschainPaymentsStore;
  failureStore?: ReturnType<typeof createMemoryFailureStore>;
  gatewayProbeUp?: boolean;
  arc?: boolean;
  gateway?: boolean;
}) {
  const staticHealth: FacilitatorHealth =
    deps.facilitator && typeof deps.facilitator !== "function"
      ? deps.facilitator
      : { status: "up", latencyMs: 120, lastError: null };
  const probe: () => Promise<FacilitatorHealth> =
    typeof deps.facilitator === "function"
      ? deps.facilitator
      : async () => staticHealth;
  const app = new Hono();
  app.route(
    "/",
    createPaymentsHealthRoutes({
      gatewayEnabled: deps.gateway ?? true,
      arcEnabled: deps.arc ?? false,
      gatewayProbeUp: deps.gatewayProbeUp ?? true,
      crosschainStore: deps.store,
      failureStore: deps.failureStore ?? createMemoryFailureStore(),
      facilitatorProbe: probe,
    }),
  );
  return app;
}

describe("GET /api/payments/health — auth", () => {
  beforeEach(() => {
    process.env.METRICS_BEARER_TOKEN = TOKEN;
  });

  it("401 without Authorization header", async () => {
    const res = await freshApp({}).request("/api/payments/health");
    expect(res.status).toBe(401);
  });

  it("401 with wrong bearer token", async () => {
    const res = await freshApp({}).request("/api/payments/health", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/payments/health — shape + semantics", () => {
  beforeEach(() => {
    process.env.METRICS_BEARER_TOKEN = TOKEN;
  });

  it("returns full JSON shape with healthy rails", async () => {
    const res = await freshApp({ arc: true }).request("/api/payments/health", {
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rails).toEqual({ exact: true, gateway: true, arc: true });
    expect(body.facilitator).toEqual({
      status: "up",
      latencyMs: 120,
      lastError: null,
    });
    expect(body.gateway).toEqual({
      pendingTransfers: 0,
      lastSettleAgeSec: null,
    });
    expect(body.failures).toEqual({ last24h: 0, lastFailure: null });
    expect(typeof body.time).toBe("string");
    expect(new Date(body.time).toString()).not.toBe("Invalid Date");
  });

  it("facilitator down → ok:false, status:'down', exact+gateway rails false, arc stays true", async () => {
    const res = await freshApp({
      arc: true,
      facilitator: { status: "down", latencyMs: null, lastError: "fetch failed" },
    }).request("/api/payments/health", { headers: AUTH });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.facilitator.status).toBe("down");
    expect(body.facilitator.lastError).toBe("fetch failed");
    expect(body.rails.exact).toBe(false);
    expect(body.rails.gateway).toBe(false);
    expect(body.rails.arc).toBe(true); // self-settle, configured = healthy
  });

  it("gateway probe down degrades gateway rail even when facilitator up", async () => {
    const res = await freshApp({ gatewayProbeUp: false }).request(
      "/api/payments/health",
      { headers: AUTH },
    );
    const body = await res.json();
    expect(body.rails.gateway).toBe(false);
    expect(body.ok).toBe(false);
  });

  it("disabled rails do not flip ok to false", async () => {
    const res = await freshApp({ gateway: false, arc: false }).request(
      "/api/payments/health",
      { headers: AUTH },
    );
    const body = await res.json();
    expect(body.rails.gateway).toBe(false);
    expect(body.rails.arc).toBe(false);
    expect(body.ok).toBe(true); // exact alone, facilitator up
  });
});

describe("gateway transfers + failures aggregation", () => {
  beforeEach(() => {
    process.env.METRICS_BEARER_TOKEN = TOKEN;
  });

  it("pendingTransfers + lastSettleAgeSec from crosschain store", async () => {
    const store = createCrosschainPaymentsStore();
    const now = Date.now();
    store.put({
      id: "a", payer: "0x1" as `0x${string}`, sourceChain: "eip155:84532",
      scheme: "gateway-batch", amountUsd: "1.00",
      payTo: "0x2" as `0x${string}`,
      ref: { kind: "x402", id: "/r" }, state: "settling",
      authorizedAt: now - 60_000,
    });
    store.put({
      id: "b", payer: "0x1" as `0x${string}`, sourceChain: "eip155:84532",
      scheme: "gateway-batch", amountUsd: "1.00",
      payTo: "0x2" as `0x${string}`,
      ref: { kind: "x402", id: "/r" }, state: "settled",
      authorizedAt: now - 600_000, settledAt: now - 300_000,
    });
    const res = await freshApp({ store }).request("/api/payments/health", {
      headers: AUTH,
    });
    const body = await res.json();
    expect(body.gateway.pendingTransfers).toBe(1);
    expect(body.gateway.lastSettleAgeSec).toBeGreaterThanOrEqual(290);
    expect(body.gateway.lastSettleAgeSec).toBeLessThanOrEqual(310);
  });

  it("failures.last24h counts only recent entries, lastFailure = latest at", async () => {
    const failureStore = createMemoryFailureStore();
    const stale = new Date(Date.now() - 25 * 3600e3).toISOString();
    // Stale entry appended directly with an aged `at` — recordFailure
    // always stamps now, so a >24h entry has to be appended raw.
    await failureStore.append({
      scheme: "exact", network: "eip155:84532",
      payer: "0x1", amount: "1", reason: "old",
      at: stale,
    });
    await recordFailure(failureStore, {
      scheme: "exact", network: "eip155:84532",
      payer: "0x1", amount: "1", reason: "recent-boom",
    });
    const res = await freshApp({ failureStore }).request(
      "/api/payments/health",
      { headers: AUTH },
    );
    const body = await res.json();
    expect(body.failures.last24h).toBe(1);
    expect(typeof body.failures.lastFailure).toBe("string");
    expect(new Date(body.failures.lastFailure).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });
});

describe("facilitatorUp gauge + probe impl", () => {
  beforeEach(() => {
    process.env.METRICS_BEARER_TOKEN = TOKEN;
  });

  it("facilitator probe result writes facilitatorUp gauge", async () => {
    facilitatorUp.set({ target: "gateway-api-testnet.circle.com" }, 0);
    const app = freshApp({
      facilitator: { status: "up", latencyMs: 55, lastError: null },
    });
    await app.request("/api/payments/health", { headers: AUTH });
    const text = await registry.metrics();
    expect(text).toMatch(
      /agentbadge_facilitator_up\{[^}]*\} 1/,
    );
  });

  it("createFacilitatorProbe caches results for cacheMs (single fetch)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("ok", { status: 200 });
    };
    const probe = createFacilitatorProbe({
      url: "https://gateway-api-testnet.circle.com",
      cacheMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const h1 = await probe();
    const h2 = await probe();
    expect(calls).toBe(1);
    expect(h1.status).toBe("up");
    expect(typeof h1.latencyMs).toBe("number");
    expect(h1.lastError).toBeNull();
    expect(h2).toEqual(h1);
  });

  it("createFacilitatorProbe reports down + lastError on fetch failure", async () => {
    const fetchImpl = async () => {
      throw new Error("boom");
    };
    const probe = createFacilitatorProbe({
      url: "https://gateway-api-testnet.circle.com",
      cacheMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const h = await probe();
    expect(h.status).toBe("down");
    expect(h.latencyMs).toBeNull();
    expect(h.lastError).toBe("boom");
  });

  it("non-2xx response → down with status code error", async () => {
    const fetchImpl = async () => new Response("nope", { status: 503 });
    const probe = createFacilitatorProbe({
      url: "https://gateway-api-testnet.circle.com",
      cacheMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const h = await probe();
    expect(h.status).toBe("down");
    expect(h.lastError).toContain("503");
  });
});

afterAll(() => {
  delete process.env.METRICS_BEARER_TOKEN;
});
