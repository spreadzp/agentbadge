/**
 * SLICE-155-6 tests: spend audit + alerts.
 *  - feed filters/cursor, wallet sig auth (403 stranger)
 *  - cap_denied emit on enforcer deny, spend.failed on settle fail
 *  - detectStaleReserves + dedupe, aggregateSpend
 *  - alert webhook retry backoff
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { buildAccessChallenge } from "../src/server/middleware/agent-auth";

import {
  createMemorySpendLedger,
  newSpendId,
  type SpendEntry,
} from "../src/server/lib/agent-wallet/ledger";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../src/server/lib/agent-wallet/registry";
import {
  createMemorySpendAlertStore,
  detectStaleReserves,
  emitSpendAlert,
  aggregateSpend,
  initSpendAlerts,
  getSpendAlertStore,
} from "../src/server/lib/agent-wallet/audit";
import { createSpendAuditRoutes } from "../src/server/routes/agent-wallet-audit-api";
import { createSpendEnforcer } from "../src/server/lib/agent-wallet/enforcer";
import { resetConfigCache } from "../src/config/env";

// Hardhat accounts — well-known test keys, never hold real funds.
const agent = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const stranger = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const W = agent.address as `0x${string}`;
const W2 = "0x00000000000000000000000000000000000000b2" as `0x${string}`;
const STRANGER = stranger.address;

async function signedGet(path: string, wallet = W) {
  const account = wallet === W ? agent : stranger;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await account.signMessage({
    message: buildAccessChallenge({
      wallet: account.address,
      method: "GET",
      path,
      timestamp,
    }),
  });
  return {
    "x-wallet": account.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
  };
}

const rec = (a: `0x${string}`, venueId?: string): AgentWalletRecord => ({
  address: a,
  label: "x",
  kind: "eoa",
  envelope: {},
  registeredBy: a.toLowerCase() as `0x${string}`,
  ...(venueId ? { venueId } : {}),
  createdAt: Date.now(),
  active: true,
});

const entry = (over: Partial<SpendEntry> = {}): SpendEntry => ({
  id: newSpendId(),
  wallet: W,
  amountUsd: 1,
  kind: "eaas",
  refId: "r1",
  state: "settled",
  txHash: `0x${"ab".repeat(32)}` as `0x${string}`,
  at: Date.now(),
  ...over,
});

beforeEach(() => {
  resetConfigCache();
  initSpendAlerts({ store: createMemorySpendAlertStore() });
});
afterEach(() => {
  initSpendAlerts(null);
  resetConfigCache();
});

describe("spend alerts", () => {
  it("emitSpendAlert stores event; webhook retries until ok", async () => {
    const posted: unknown[] = [];
    let calls = 0;
    initSpendAlerts({
      store: createMemorySpendAlertStore(),
      webhookUrl: "https://hook.example/x",
      sleep: async () => {},
      fetchFn: (async () => {
        calls++;
        if (calls < 3) throw new Error("down");
        posted.push(1);
        return new Response("ok");
      }) as unknown as typeof fetch,
    });
    emitSpendAlert("wallet.low_balance", W, { usdc: "0.5" }, "v1");
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(calls).toBe(3);
    const evs = getSpendAlertStore()!.list({ type: "wallet.low_balance" });
    expect(evs).toHaveLength(1);
    expect(evs[0].venueId).toBe("v1");
    expect(evs[0].data.usdc).toBe("0.5");
  });

  it("enforcer deny → spend.cap_denied with cap context", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put({
      ...rec(W),
      envelope: { perTxUsd: 1 },
    });
    const enforcer = createSpendEnforcer({
      registry: store,
      ledger: createMemorySpendLedger(),
      requireRegistered: false,
    });
    const c = {
      req: { header: () => W, method: "GET", path: "/x" },
      get: () => undefined,
      json: (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s }),
    } as unknown as Parameters<ReturnType<typeof createSpendEnforcer>["begin"]>[0];
    // reserve 2 over perTx cap 1 → denied
    return enforcer.begin(c, 2, "eaas", "r").then((res) => {
      expect(res).toBeInstanceOf(Response);
      const evs = getSpendAlertStore()!.list({ type: "spend.cap_denied" });
      expect(evs).toHaveLength(1);
      expect(evs[0].data).toMatchObject({ cap: "perTx", amountUsd: 2 });
    });
  });

  it("settle fail after reserve → spend.failed", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put({ ...rec(W), envelope: { perTxUsd: 10 } });
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({
      registry: store,
      ledger,
      requireRegistered: false,
    });
    const c = {
      req: { header: () => W, method: "GET", path: "/x" },
      get: () => undefined,
      json: (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s }),
    } as unknown as Parameters<ReturnType<typeof createSpendEnforcer>["begin"]>[0];
    const begun = await enforcer.begin(c, 5, "eaas", "r2");
    if (begun instanceof Response) throw new Error("expected begin");
    expect(begun.entry).toBeDefined();
    enforcer.complete(begun, false, 5, "eaas", "r2");
    const evs = getSpendAlertStore()!.list({ type: "spend.failed" });
    expect(evs).toHaveLength(1);
    expect(evs[0].data.refId).toBe("r2");
  });

  it("detectStaleReserves emits once per entry", () => {
    const ledger = createMemorySpendLedger();
    const e = entry({ state: "reserved", at: Date.now() - 20 * 60_000 });
    ledger.insert(e);
    const deps = {
      ledger,
      wallets: [rec(W, "v1")],
      staleMs: 10 * 60_000,
      store: getSpendAlertStore()!,
    };
    const first = detectStaleReserves(deps);
    const second = detectStaleReserves(deps);
    expect(first).toHaveLength(1);
    expect(first[0].type).toBe("spend.release_late");
    expect(first[0].data.entryId).toBe(e.id);
    expect(first[0].venueId).toBe("v1");
    expect(second).toHaveLength(0); // deduped
    // fresh reserved not flagged
    ledger.insert(entry({ state: "reserved", at: Date.now() }));
    expect(detectStaleReserves(deps)).toHaveLength(0);
  });
});

describe("audit feed routes", () => {
  async function build() {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, "v-test"));
    const ledger = createMemorySpendLedger();
    ledger.insert(entry({ kind: "eaas", amountUsd: 1, at: 1000 }));
    ledger.insert(entry({ kind: "x402", amountUsd: 2, state: "reserved", at: 2000, txHash: undefined }));
    ledger.insert(entry({ kind: "eaas", amountUsd: 3, state: "released", at: 3000 }));
    const app = new Hono();
    app.route(
      "/",
      createSpendAuditRoutes({ store, ledger, alerts: getSpendAlertStore }),
    );
    return { app, store, ledger };
  }

  it("401 without sig; owner gets entries + alerts (filters work)", async () => {
    const { app } = await build();
    const noSig = await app.request(`/api/wallets/${W}/audit`);
    expect(noSig.status).toBe(401);

    const ok = await app.request(`/api/wallets/${W}/audit`, {
      headers: await signedGet(`/api/wallets/${W}/audit`),
    });
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.entries).toHaveLength(3); // newest first
    expect(j.entries[0].at).toBe(3000);
    expect(j.nextCursor).toBeNull();

    const filtered = await app.request(
      `/api/wallets/${W}/audit?kind=x402&state=reserved`,
      {
        headers: await signedGet(
          `/api/wallets/${W}/audit?kind=x402&state=reserved`,
        ),
      },
    );
    const f = await filtered.json();
    expect(f.entries).toHaveLength(1);
    expect(f.entries[0].kind).toBe("x402");
  });

  it("403 stranger; cursor paginates", async () => {
    const { app } = await build();
    const denied = await app.request(`/api/wallets/${W}/audit`, {
      headers: await signedGet(`/api/wallets/${W}/audit`, STRANGER),
    });
    expect(denied.status).toBe(403);

    const p1 = await app.request(`/api/wallets/${W}/audit?limit=2`, {
      headers: await signedGet(`/api/wallets/${W}/audit?limit=2`),
    });
    const j1 = await p1.json();
    expect(j1.entries).toHaveLength(2);
    expect(j1.nextCursor).toBe(j1.entries[1].id);
    const p2 = await app.request(
      `/api/wallets/${W}/audit?limit=2&cursor=${j1.nextCursor}`,
      {
        headers: await signedGet(
          `/api/wallets/${W}/audit?limit=2&cursor=${j1.nextCursor}`,
        ),
      },
    );
    const j2 = await p2.json();
    expect(j2.entries).toHaveLength(1);
    expect(j2.nextCursor).toBeNull();
  });
});

describe("aggregateSpend", () => {
  it("sums settled only, groups by kind + wallet", () => {
    const stats = aggregateSpend([
      entry({ amountUsd: 1, kind: "eaas" }),
      entry({ amountUsd: 2, kind: "x402", wallet: W2 }),
      entry({ amountUsd: 9, kind: "eaas", state: "released" }),
      entry({ amountUsd: 5, kind: "eaas", state: "reserved" }),
    ]);
    expect(stats.totalUsd).toBe(3);
    expect(stats.byKind).toEqual({ eaas: 1, x402: 2 });
    expect(stats.byAgent[W.toLowerCase()]).toBe(1);
    expect(stats.byAgent[W2.toLowerCase()]).toBe(2);
  });
});
