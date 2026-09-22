/**
 * SLICE-141-7: bStock freemium — free 1 req/min → 402 + PAYMENT-REQUIRED
 * → x402 payment → ServicePass → real-time access. Pass expiry → 402.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createNamespace, registerBstockTools } from "@agentbadge/mcp";
import type { BstockEngineLike } from "@agentbadge/mcp";
import { createNamespaceRoutes } from "../src/server/routes/mcp-namespace";
import { bstockAuth } from "../src/server/middleware/bstock-gate";
import {
  bstockFreemium,
  type BstockFreemiumConfig,
} from "../src/server/middleware/bstock-freemium";
import {
  ensureBstockService,
  BSTOCK_SERVICE_ID,
} from "../src/server/lib/bstock/service";
import {
  useMemoryStoreForTesting,
  resetStoreForTesting,
  getService,
} from "../src/server/lib/marketplace/catalog";

const TOKENS = new Map([["tok-agent1", "agent1"]]);
const WALLET = "0x1111111111111111111111111111111111111111";

function mockEngine(): BstockEngineLike {
  return {
    getDelta: () => null,
    listDeltas: () => [],
    getEvents: () => [],
    getHistory: () => [],
  };
}

interface MintCall {
  to: string;
  serviceId: string;
  durationSec: number;
}

function makeApp(overrides: Partial<BstockFreemiumConfig> = {}) {
  const mints: MintCall[] = [];
  const cfg: BstockFreemiumConfig = {
    serviceId: BSTOCK_SERVICE_ID,
    priceUsd: "5",
    durationSec: 30 * 86_400,
    payTo: "0x2222222222222222222222222222222222222222",
    networkId: "eip155:84532",
    usdcAddress: "0x3333333333333333333333333333333333333333",
    freePerMin: 1,
    facilitator: {
      verify: async () => ({ valid: true }),
      settle: async () => ({ success: true, transaction: "0xtx", payer: WALLET }),
    },
    hasAccess: async () => false,
    mintPass: async (to, serviceId, durationSec) => {
      mints.push({ to, serviceId, durationSec });
      return "0xmint";
    },
    ...overrides,
  };
  const ns = createNamespace("bstock");
  registerBstockTools(mockEngine(), ns);
  const app = new Hono();
  app.use("/mcp/bstock/*", bstockAuth(TOKENS), bstockFreemium(cfg));
  app.route("/mcp/bstock", createNamespaceRoutes("bstock"));
  return { app, mints };
}

const auth = { Authorization: "Bearer tok-agent1" };
const callTool = (app: Hono, headers: Record<string, string> = {}) =>
  app.request("/mcp/bstock/tools/list_deltas", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", ...headers },
    body: "{}",
  });

describe("free tier: 1 req/min → 402", () => {
  it("first request passes, second within a minute → 402 + PAYMENT-REQUIRED", async () => {
    const { app } = makeApp();
    expect((await callTool(app)).status).toBe(200);
    const res = await callTool(app);
    expect(res.status).toBe(402);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    const body = await res.json();
    expect(body.accepts ?? body.error).toBeTruthy();
  });
});

describe("paid tier: ServicePass → real-time", () => {
  it("wallet with live pass bypasses free limit", async () => {
    const { app } = makeApp({
      hasAccess: async (w) => w === WALLET,
    });
    for (let i = 0; i < 5; i++) {
      const res = await callTool(app, { "X-Wallet": WALLET });
      expect(res.status).toBe(200);
    }
  });

  it("expired pass (hasAccess=false) falls back to free tier → 402", async () => {
    const { app } = makeApp({ hasAccess: async () => false });
    expect(
      (await callTool(app, { "X-Wallet": WALLET })).status,
    ).toBe(200);
    const res = await callTool(app, { "X-Wallet": WALLET });
    expect(res.status).toBe(402);
  });
});

describe("x402 payment → ServicePass mint", () => {
  it("PAYMENT-SIGNATURE → verify+settle → mintServicePass → 200", async () => {
    const { app, mints } = makeApp();
    const res = await callTool(app, { "PAYMENT-SIGNATURE": "sig123" });
    expect(res.status).toBe(200);
    expect(mints).toHaveLength(1);
    expect(mints[0].to).toBe(WALLET);
    expect(mints[0].serviceId).toBe(BSTOCK_SERVICE_ID);
    expect(mints[0].durationSec).toBe(30 * 86_400);
  });

  it("invalid payment → 402, no mint", async () => {
    const { app, mints } = makeApp({
      facilitator: {
        verify: async () => ({ valid: false, error: "bad sig" }),
        settle: async () => ({ success: false, error: "no" }),
      },
    });
    const res = await callTool(app, { "PAYMENT-SIGNATURE": "bad" });
    expect(res.status).toBe(402);
    expect(mints).toHaveLength(0);
  });
});

describe("service registration", () => {
  afterEach(() => resetStoreForTesting());

  it("ensureBstockService registers bstock-delta-realtime $5/30d", () => {
    useMemoryStoreForTesting();
    ensureBstockService();
    const svc = getService(BSTOCK_SERVICE_ID);
    expect(svc).toBeTruthy();
    expect(svc?.name).toBe("bstock-delta-realtime");
    expect(svc?.priceUsd).toBe("5");
    expect(svc?.durationDays).toBe(30);
    expect(svc?.durationSec).toBe(30 * 86_400);
  });
});
