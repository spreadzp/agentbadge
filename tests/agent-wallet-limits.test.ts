/**
 * SLICE-155-3 tests: limits mirror + OTP-handoff command endpoint.
 *  - GET /limits: envelope + circle PolicyCaps | "unavailable" | "mainnet-only"
 *  - POST /limits/command: monotonic validation + verbatim CLI string
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import { createMemorySpendLedger } from "../src/server/lib/agent-wallet/ledger";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../src/server/lib/agent-wallet/registry";
import { createAgentWalletLimitsRoutes } from "../src/server/routes/agent-wallet-limits-api";
import type { CircleCliClient, PolicyCaps } from "@agentbadge/circle-payments";
import { CliUnavailableError } from "@agentbadge/circle-payments";
import { resetConfigCache } from "../src/config/env";

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;

const rec = (address: `0x${string}`): AgentWalletRecord => ({
  address,
  label: "x",
  kind: "eoa",
  envelope: { dailyUsd: 100 },
  registeredBy: address.toLowerCase() as `0x${string}`,
  createdAt: Date.now(),
  active: true,
});

const cliStub = (limits: () => Promise<PolicyCaps>): CircleCliClient =>
  ({
    status: async () => ({ loggedIn: true }),
    list: async () => [],
    balance: async () => ({ usd: "0" }),
    limits,
  }) as unknown as CircleCliClient;

function appFor(opts: {
  chain?: string;
  cli?: CircleCliClient;
}): Hono {
  const store = createMemoryAgentWalletStore();
  store.put(rec(W));
  const ledger = createMemorySpendLedger();
  const app = new Hono();
  app.route(
    "/",
    createAgentWalletLimitsRoutes({
      store,
      ledger,
      chain: opts.chain ?? "ARC",
      ...(opts.cli ? { cli: opts.cli } : {}),
    }),
  );
  return app;
}

beforeEach(() => resetConfigCache());
afterEach(() => resetConfigCache());

describe("GET /api/wallets/:a/limits", () => {
  it("mainnet chain + CLI ok → envelope + circle PolicyCaps", async () => {
    const app = appFor({
      cli: cliStub(async () => ({ perTx: "1", daily: "5", weekly: "20", monthly: "50" })),
    });
    const res = await app.request(`/api/wallets/${W}/limits`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.envelope.caps.dailyUsd).toBe(100);
    expect(body.envelope.usage.daily.cap).toBe(100);
    expect(body.circle).toMatchObject({ perTx: "1", daily: "5" });
  });

  it("non-mainnet chain → circle:'mainnet-only' without CLI call", async () => {
    let called = false;
    const app = appFor({
      chain: "ARC-TESTNET",
      cli: cliStub(async () => {
        called = true;
        return {};
      }),
    });
    const res = await app.request(`/api/wallets/${W}/limits`);
    expect((await res.json()).circle).toBe("mainnet-only");
    expect(called).toBe(false);
  });

  it("CLI throws CliUnavailableError → circle:'unavailable'", async () => {
    const app = appFor({
      cli: cliStub(async () => {
        throw new CliUnavailableError("no binary");
      }),
    });
    const res = await app.request(`/api/wallets/${W}/limits`);
    expect((await res.json()).circle).toBe("unavailable");
  });

  it("no CLI injected → 'unavailable'; 60s cache dedupes CLI calls", async () => {
    const app = appFor({});
    expect((await (await app.request(`/api/wallets/${W}/limits`)).json()).circle)
      .toBe("unavailable");

    let calls = 0;
    const app2 = appFor({
      cli: cliStub(async () => {
        calls += 1;
        return { daily: "5" };
      }),
    });
    await app2.request(`/api/wallets/${W}/limits`);
    await app2.request(`/api/wallets/${W}/limits`);
    expect(calls).toBe(1);
  });

  it("unknown wallet → 404", async () => {
    const app = appFor({});
    const res = await app.request(
      "/api/wallets/0x00000000000000000000000000000000000000ff/limits",
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/wallets/:a/limits/command", () => {
  it("valid caps → verbatim circle wallet limit set command", async () => {
    const app = appFor({});
    const res = await app.request(`/api/wallets/${W}/limits/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ perTxUsd: 1, dailyUsd: 5, weeklyUsd: 20, monthlyUsd: 50 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commandLine).toBe(
      `circle wallet limit set --address ${W} --chain ARC ` +
        "--policy-type stablecoin --per-tx 1 --daily 5 --weekly 20 --monthly 50",
    );
    expect(body.note).toMatch(/OTP/);
  });

  it("non-monotonic caps → 400", async () => {
    const app = appFor({});
    const res = await app.request(`/api/wallets/${W}/limits/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dailyUsd: 100, weeklyUsd: 50 }),
    });
    expect(res.status).toBe(400);
  });

  it("partial caps → only provided flags; unknown wallet → 404", async () => {
    const app = appFor({});
    const res = await app.request(`/api/wallets/${W}/limits/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dailyUsd: 5 }),
    });
    const body = await res.json();
    expect(body.commandLine).toBe(
      `circle wallet limit set --address ${W} --chain ARC --policy-type stablecoin --daily 5`,
    );
    const miss = await app.request(
      "/api/wallets/0x00000000000000000000000000000000000000ff/limits/command",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyUsd: 5 }),
      },
    );
    expect(miss.status).toBe(404);
  });
});
