/**
 * SLICE-141-6: /mcp/bstock namespace — bearer auth (MCP_AGENT_TOKENS),
 * per-token rate limit 60/min, SSE connection cap 20, engine wiring.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createNamespace, registerBstockTools } from "@agentbadge/mcp";
import type { BstockEngineLike } from "@agentbadge/mcp";
import { createNamespaceRoutes } from "../src/server/routes/mcp-namespace";
import {
  bstockAuth,
  bstockRateLimit,
  BstockSseCap,
  bstockSseCap,
} from "../src/server/middleware/bstock-gate";
import { loadBstock } from "../src/config/env/bstock";

const TOKENS = new Map([
  ["tok-agent1", "agent1"],
  ["tok-agent2", "agent2"],
]);

function mockEngine(): BstockEngineLike {
  return {
    getDelta: (s: string) =>
      s === "AAPLB"
        ? {
            symbol: "AAPLB", underlying: "AAPL", multiplier: 1,
            bStockPrice: 182.5, underlyingPrice: 181.2,
            deltaPct: 0.7174, phase: "O", stale: false,
            inAlert: false, lastUpdateMs: 1,
          }
        : null,
    listDeltas: () => [],
    getEvents: () => [],
    getHistory: () => [],
  };
}

function makeApp(sseCap?: BstockSseCap) {
  const app = new Hono();
  const fixed = createNamespace("bstock");
  registerBstockTools(mockEngine(), fixed);
  app.use(
    "/mcp/bstock/*",
    bstockAuth(TOKENS),
    bstockRateLimit(60),
    bstockSseCap(sseCap ?? new BstockSseCap(20)),
  );
  app.route("/mcp/bstock", createNamespaceRoutes("bstock"));
  return app;
}

const auth = { Authorization: "Bearer tok-agent1" };

describe("namespace registration", () => {
  it("bstock namespace has exactly the 5 bstock tools", () => {
    const ns = createNamespace("bstock-iso");
    registerBstockTools(mockEngine(), ns);
    expect(ns.listTools().map((t) => t.name).sort()).toEqual([
      "get_delta", "get_digest", "get_events", "get_quote", "list_deltas",
    ]);
  });
});

describe("bearer auth (Q4b)", () => {
  it("401 without token", async () => {
    const app = makeApp();
    const res = await app.request("/mcp/bstock/tools");
    expect(res.status).toBe(401);
  });

  it("401 with invalid token", async () => {
    const app = makeApp();
    const res = await app.request("/mcp/bstock/tools", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("200 with valid token, returns tools", async () => {
    const app = makeApp();
    const res = await app.request("/mcp/bstock/tools", { headers: auth });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toHaveLength(5);
  });

  it("tool call works with valid token", async () => {
    const app = makeApp();
    const res = await app.request("/mcp/bstock/tools/get_delta", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "AAPLB" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const data = JSON.parse(body.content[0].text);
    expect(data.deltaPct).toBeCloseTo(0.7174, 3);
  });
});

describe("rate limit 60 req/min per-token", () => {
  it("429 after 60 requests from same token", async () => {
    const app = makeApp();
    for (let i = 0; i < 60; i++) {
      const res = await app.request("/mcp/bstock/tools", { headers: auth });
      expect(res.status).toBe(200);
    }
    const res = await app.request("/mcp/bstock/tools", { headers: auth });
    expect(res.status).toBe(429);
  });

  it("other token unaffected", async () => {
    const app = makeApp();
    for (let i = 0; i < 60; i++) {
      await app.request("/mcp/bstock/tools", { headers: auth });
    }
    const res = await app.request("/mcp/bstock/tools", {
      headers: { Authorization: "Bearer tok-agent2" },
    });
    expect(res.status).toBe(200);
  });
});

describe("SSE connection cap (max 20)", () => {
  it("503 when cap is full", async () => {
    const cap = new BstockSseCap(20);
    for (let i = 0; i < 20; i++) cap.tryAcquire();
    const app = makeApp(cap);
    const res = await app.request("/mcp/bstock/", {
      headers: { ...auth, Accept: "text/event-stream" },
    });
    expect(res.status).toBe(503);
  });

  it("cap releases on release()", () => {
    const cap = new BstockSseCap(2);
    expect(cap.tryAcquire()).toBe(true);
    expect(cap.tryAcquire()).toBe(true);
    expect(cap.tryAcquire()).toBe(false);
    cap.release();
    expect(cap.tryAcquire()).toBe(true);
  });
});

describe("env: loadBstock", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns undefined when BSTOCK_ENABLED is not true", () => {
    delete process.env.BSTOCK_ENABLED;
    const errors: string[] = [];
    expect(loadBstock(errors)).toBeUndefined();
    expect(errors).toHaveLength(0);
  });

  it("parses MCP_AGENT_TOKENS=agent:token,...", () => {
    process.env.BSTOCK_ENABLED = "true";
    process.env.MCP_AGENT_TOKENS = "agent1:tok1, agent2:tok2";
    const errors: string[] = [];
    const cfg = loadBstock(errors);
    expect(errors).toHaveLength(0);
    expect(cfg?.agentTokens.get("tok1")).toBe("agent1");
    expect(cfg?.agentTokens.get("tok2")).toBe("agent2");
    expect(cfg?.rateLimitPerMin).toBe(60);
    expect(cfg?.maxSseConnections).toBe(20);
  });

  it("errors when enabled without tokens", () => {
    process.env.BSTOCK_ENABLED = "true";
    delete process.env.MCP_AGENT_TOKENS;
    const errors: string[] = [];
    loadBstock(errors);
    expect(errors.length).toBeGreaterThan(0);
  });
});
