/**
 * SLICE-155-5 tests: funding flows.
 *  - readWalletBalance: cli → rpc → unavailable; 18/6 dual view; gateway
 *  - GET /api/wallets/:a/balance + /deposit-qr.svg (eip155 URI)
 *  - checkLowBalances: threshold, unavailable-skip, onAlert, webhook
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import {
  CliUnavailableError,
  type CircleCliClient,
} from "@agentbadge/circle-payments";
import { readWalletBalance } from "../src/server/lib/agent-wallet/balance";
import { checkLowBalances } from "../src/server/lib/agent-wallet/funding";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../src/server/lib/agent-wallet/registry";
import { createAgentWalletBalanceRoutes } from "../src/server/routes/agent-wallet-balance-api";
import { resetConfigCache } from "../src/config/env";

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;

const rec = (a: `0x${string}`): AgentWalletRecord => ({
  address: a,
  label: "x",
  kind: "eoa",
  envelope: {},
  registeredBy: a.toLowerCase() as `0x${string}`,
  createdAt: Date.now(),
  active: true,
});

const cliStub = (balance: () => Promise<string>): CircleCliClient =>
  ({ balance }) as unknown as CircleCliClient;

beforeEach(() => resetConfigCache());
afterEach(() => resetConfigCache());

describe("readWalletBalance", () => {
  it("cli ok → source cli, rpc untouched", async () => {
    let rpcCalls = 0;
    const bal = await readWalletBalance(W, {
      cli: cliStub(async () => "12.34"),
      chain: "ARC",
      usdcAddress: USDC,
      rpcUrl: "http://x",
      readContract: async () => {
        rpcCalls++;
        return 0n;
      },
    });
    expect(bal).toMatchObject({ usdc: "12.34", source: "cli" });
    expect(rpcCalls).toBe(0);
  });

  it("cli down → rpc fallback: balanceOf 6dec + native 18dec view", async () => {
    const bal = await readWalletBalance(W, {
      cli: cliStub(async () => {
        throw new CliUnavailableError("no binary");
      }),
      chain: "ARC",
      usdcAddress: USDC,
      rpcUrl: "http://x",
      readContract: async () => 12_340_000n, // 12.34 USDC (6 dec)
      getBalance: async () => 12_340_000_000_000_000_000n, // 12.34 (18dec)
    });
    expect(bal.source).toBe("rpc");
    expect(bal.usdc).toBe("12.34");
    expect(bal.nativeUsdc).toBe("12.34"); // ONE balance, dual view
  });

  it('cli "unavailable" string → falls to rpc; both down → unavailable', async () => {
    const a = await readWalletBalance(W, {
      cli: cliStub(async () => "unavailable"),
      chain: "ARC",
      usdcAddress: USDC,
      readContract: async () => 5_000_000n,
    });
    expect(a.source).toBe("rpc");
    expect(a.usdc).toBe("5");

    const b = await readWalletBalance(W, {
      cli: cliStub(async () => {
        throw new CliUnavailableError("x");
      }),
      chain: "ARC",
      usdcAddress: USDC,
      readContract: async () => {
        throw new Error("rpc down");
      },
    });
    expect(b.source).toBe("unavailable");
  });

  it("gateway probe: populated on ok, null on failure", async () => {
    const withGw = await readWalletBalance(W, {
      chain: "ARC",
      usdcAddress: USDC,
      readContract: async () => 1_000_000n,
      gatewayApiUrl: "https://gw.example",
      domain: 26,
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            balances: [{ balance: "5.00", withdrawing: "0", withdrawable: "4.50" }],
          }),
        )) as unknown as typeof fetch,
    });
    expect(withGw.gateway).toEqual({
      available: "5.00",
      withdrawing: "0",
      withdrawable: "4.50",
    });

    const noGw = await readWalletBalance(W, {
      chain: "ARC",
      usdcAddress: USDC,
      readContract: async () => 1_000_000n,
      gatewayApiUrl: "https://gw.example",
      domain: 26,
      fetchFn: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    expect(noGw.gateway).toBeNull();
  });
});

describe("balance + QR routes", () => {
  async function appFor() {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W));
    const app = new Hono();
    app.route(
      "/",
      createAgentWalletBalanceRoutes({
        store,
        chain: "ARC",
        chainId: 5042,
        readBalance: async () => ({
          chain: "ARC",
          usdc: "9.99",
          gateway: null,
          source: "rpc",
        }),
      }),
    );
    return app;
  }

  it("GET /balance → usdc + source + funding handoff", async () => {
    const res = await (await appFor()).request(`/api/wallets/${W}/balance`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.usdc).toBe("9.99");
    expect(j.source).toBe("rpc");
    expect(j.funding.transfer.uri).toBe(`ethereum:${W}@5042`);
    expect(j.funding.transfer.network).toBe("eip155:5042");
    expect(j.funding.gatewayDeposit.commandLine).toMatch(
      /^circle gateway deposit --address 0x[0-9a-f]+ --chain ARC --amount <USD>$/,
    );
  });

  it("GET /deposit-qr.svg → svg containing QR; 404/400 guards", async () => {
    const app = await appFor();
    const res = await app.request(`/api/wallets/${W}/deposit-qr.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/svg/);
    expect(await res.text()).toMatch(/<svg/);
    expect(
      (await app.request("/api/wallets/0xZZZ/deposit-qr.svg")).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/api/wallets/0x00000000000000000000000000000000000000ff/balance",
        )
      ).status,
    ).toBe(404);
  });
});

describe("checkLowBalances", () => {
  const base = {
    wallets: () => [rec(W)],
    thresholdUsd: 1,
  };

  it("below threshold → event + onAlert + webhook POST", async () => {
    const alerts: unknown[] = [];
    const posted: unknown[] = [];
    const events = await checkLowBalances({
      ...base,
      readBalance: async () => ({
        chain: "ARC",
        usdc: "0.5",
        gateway: null,
        source: "cli",
      }),
      onAlert: (ev) => {
        alerts.push(ev);
      },
      webhookUrl: "https://hook.example/x",
      fetchFn: (async (u: string, init: RequestInit) => {
        posted.push({ u, body: JSON.parse(init.body as string) });
        return new Response("ok");
      }) as typeof fetch,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ address: W, usdc: "0.5" });
    expect(alerts).toHaveLength(1);
    expect((posted[0] as { body: { event: string } }).body.event).toBe(
      "agent_wallet_low_balance",
    );
  });

  it("at/above threshold or unavailable → no events", async () => {
    const ok = await checkLowBalances({
      ...base,
      readBalance: async () => ({
        chain: "ARC",
        usdc: "1.0",
        gateway: null,
        source: "cli",
      }),
    });
    expect(ok).toHaveLength(0);
    const unavail = await checkLowBalances({
      ...base,
      readBalance: async () => ({
        chain: "ARC",
        usdc: "0",
        gateway: null,
        source: "unavailable",
      }),
    });
    expect(unavail).toHaveLength(0);
    const thrower = await checkLowBalances({
      ...base,
      readBalance: async () => {
        throw new Error("down");
      },
    });
    expect(thrower).toHaveLength(0);
  });
});
