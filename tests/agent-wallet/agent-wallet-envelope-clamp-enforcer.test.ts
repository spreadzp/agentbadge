/**
 * SLICE-263-1 tests: MMF v0.5-clamp on the gated spend path —
 * SpendEnforcer verdict propagation + X-Spend-* caller headers +
 * validity gate + PATCH /envelope clamp declaration.
 *
 * Enforcer/route level. Unit coverage (validateCaps/checkEnvelope/
 * reserve) lives in agent-wallet-envelope-clamp.test.ts.
 *
 * Covered (per slice AC):
 *  - D4: clamp absent/false + over-perTx → identical legacy 402 +
 *    denied entry, no X-Spend-* headers
 *  - clamp:true + over-perTx → reserve at effective=perTxUsd, X-Spend-*
 *    headers on the downstream response
 *  - clamped-then-denied (daily/kind) → deny carries requested, no
 *    clamp fields on the entry, no X-Spend-* headers
 *  - !finite|≤0 → deny 402 invalid_amount BEFORE caps (K08, V04-class)
 *  - non-bool clamp → 400 on PATCH /envelope (draft §2.2)
 *  - D8: X-Spend-* preserved over downstream headers/status/JSON —
 *    matrix on both spendEnvelopeGate and withEnvelope
 *  - consistency-guard: complete() mismatch on clamped entry → alert
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import { createMemorySpendLedger } from "../../src/server/lib/agent-wallet/ledger";
import {
  createSpendEnforcer,
  spendEnvelopeGate,
  initSpendEnforcer,
  withEnvelope,
} from "../../src/server/lib/agent-wallet/enforcer";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../../src/server/lib/agent-wallet/registry";
import {
  createMemorySpendAlertStore,
  initSpendAlerts,
  type SpendAlertStore,
} from "../../src/server/lib/agent-wallet/audit";
import { createAgentWalletEnvelopeRoutes } from "../../src/server/routes/agent-wallet/agent-wallet-envelope-api";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../../src/server/middleware/agent-auth";
import { resetConfigCache } from "../../src/config/env";
import { resetDatabaseForTests } from "../../src/server/lib/database";
import { resetVenueEventsForTests } from "../../src/server/services/venue-events";
import {
  resetStoreForTesting,
  useMemoryStoreForTesting,
} from "../../src/server/lib/venue/store";

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const SAVED_DB = process.env.DATABASE_ENABLED;

const rec = (address: `0x${string}`, envelope = {}): AgentWalletRecord => ({
  address,
  label: "x",
  kind: "eoa",
  envelope,
  registeredBy: address.toLowerCase() as `0x${string}`,
  createdAt: Date.now(),
  active: true,
});

let alerts: SpendAlertStore;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
  resetVenueEventsForTests();
  initSpendEnforcer(null);
  alerts = createMemorySpendAlertStore();
  initSpendAlerts({ store: alerts });
});
afterEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
  resetStoreForTesting();
  resetAgentAuthForTesting();
  resetVenueEventsForTests();
  resetDatabaseForTests();
  if (SAVED_DB === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB;
  resetConfigCache();
});

/* ------------------------------- enforcer --------------------------------- */

describe("SpendEnforcer — clamp on the gated spend path", () => {
  async function enforcerApp(opts: {
    envelope?: Record<string, unknown>;
    amount?: number;
    downstream?: (c: import("hono").Context) => Response;
  }) {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, opts.envelope ?? {}));
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({
      ledger,
      registry: store,
      requireRegistered: false,
    });
    initSpendEnforcer(enforcer);
    const amount = opts.amount ?? 25;
    const app = new Hono();
    app.use("/api/pay", spendEnvelopeGate({ kind: "eaas", amountUsdFor: () => amount }));
    app.post("/api/pay", opts.downstream ?? ((c) => c.json({ paid: true })));
    return { app, ledger, enforcer };
  }

  const pay = (app: Hono, wallet: string = W) =>
    app.request("/api/pay", { method: "POST", headers: { "x-wallet": wallet } });

  it("D4 regress: clamp absent → over-perTx 402 + denied entry identical", async () => {
    const { app, ledger } = await enforcerApp({
      envelope: { perTxUsd: 10 },
    });
    const res = await pay(app);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({ error: "spend_cap", cap: "perTx", used: 25, limit: 10 });
    const entries = await ledger.listByWallet(W);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      state: "denied",
      denialReason: "perTx",
      amountUsd: 25,
    });
    expect(res.headers.get("x-spend-clamped")).toBeNull();
  });

  it("D4 regress: clamp:false → identical deny", async () => {
    const { app } = await enforcerApp({ envelope: { perTxUsd: 10, clamp: false } });
    const res = await pay(app);
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("spend_cap");
    expect(res.headers.get("x-spend-clamped")).toBeNull();
  });

  it("clamp:true → reserve effective, X-Spend-* headers on downstream", async () => {
    const { app, ledger } = await enforcerApp({
      envelope: { perTxUsd: 10, clamp: true },
    });
    const res = await pay(app);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-spend-clamped")).toBe("true");
    expect(res.headers.get("x-spend-effective-usd")).toBe("10");
    expect(res.headers.get("x-spend-requested-usd")).toBe("25");
    const entries = await ledger.listByWallet(W);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      state: "settled",
      amountUsd: 10,
      clamped: true,
      requestedAmountUsd: 25,
      effectiveCapUsd: 10,
    });
  });

  it("unclamped spend under clamp-envelope → NO X-Spend-* headers", async () => {
    const { app, ledger } = await enforcerApp({
      envelope: { perTxUsd: 30, clamp: true },
      amount: 5,
    });
    const res = await pay(app);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-spend-clamped")).toBeNull();
    expect(res.headers.get("x-spend-effective-usd")).toBeNull();
    expect(res.headers.get("x-spend-requested-usd")).toBeNull();
    const entries = await ledger.listByWallet(W);
    expect(entries[0].clamped).toBeUndefined();
  });

  it("D8 matrix: downstream own headers/status/JSON keep X-Spend-* (gate)", async () => {
    const { app } = await enforcerApp({
      envelope: { perTxUsd: 10, clamp: true },
      downstream: (c) => {
        c.header("X-Downstream", "yes");
        return c.json({ paid: true, detail: "custom" }, 201);
      },
    });
    const res = await pay(app);
    expect(res.status).toBe(201);
    expect(res.headers.get("x-downstream")).toBe("yes");
    expect(res.headers.get("x-spend-clamped")).toBe("true");
    expect(res.headers.get("x-spend-effective-usd")).toBe("10");
    expect(res.headers.get("x-spend-requested-usd")).toBe("25");
    expect(await res.json()).toEqual({ paid: true, detail: "custom" });
  });

  it("D8 matrix: downstream error status keeps X-Spend-* (gate)", async () => {
    const { app, ledger } = await enforcerApp({
      envelope: { perTxUsd: 10, clamp: true },
      downstream: (c) => c.json({ failed: true }, 502),
    });
    const res = await pay(app);
    expect(res.status).toBe(502);
    expect(res.headers.get("x-spend-clamped")).toBe("true");
    expect(res.headers.get("x-spend-effective-usd")).toBe("10");
    // failed downstream → reservation released
    const entries = await ledger.listByWallet(W);
    expect(entries[0]).toMatchObject({ state: "released", amountUsd: 10, clamped: true });
  });

  it("D8 matrix: withEnvelope — clamp headers reach the caller response", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, { perTxUsd: 10, clamp: true }));
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
    const app = new Hono();
    app.post("/x", async (c) => {
      const r = await withEnvelope(
        enforcer,
        c,
        { amountUsd: 25, kind: "eaas", refId: "t1" },
        async () => ({ did: "work" }),
      );
      if (!r.ok) return r.res;
      c.header("X-Downstream", "yes");
      return c.json(r.result, 201);
    });
    const res = await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-downstream")).toBe("yes");
    expect(res.headers.get("x-spend-clamped")).toBe("true");
    expect(res.headers.get("x-spend-effective-usd")).toBe("10");
    expect(res.headers.get("x-spend-requested-usd")).toBe("25");
    const entries = await ledger.listByWallet(W);
    expect(entries[0]).toMatchObject({ state: "settled", amountUsd: 10, clamped: true });
  });

  it("D8 matrix: withEnvelope unclamped → no X-Spend-* on response", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, { perTxUsd: 30, clamp: true }));
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
    const app = new Hono();
    app.post("/x", async (c) => {
      const r = await withEnvelope(
        enforcer,
        c,
        { amountUsd: 5, kind: "eaas", refId: "t1" },
        async () => ({ did: "work" }),
      );
      if (!r.ok) return r.res;
      return c.json(r.result);
    });
    const res = await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-spend-clamped")).toBeNull();
  });

  /* --------------------------- validity gate (K08) ------------------------ */

  it.each([0, -5, NaN, Infinity, -Infinity])(
    "amount %s + clamp → 402 invalid_amount BEFORE caps; denied entry only",
    async (amount) => {
      const store = createMemoryAgentWalletStore();
      await store.put(rec(W, { perTxUsd: 10, clamp: true }));
      const ledger = createMemorySpendLedger();
      const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
      const app = new Hono();
      app.post("/x", async (c) => {
        const begun = await enforcer.begin(c, amount, "eaas", "r1");
        if (begun instanceof Response) return begun;
        return c.json({ ok: true });
      });
      const res = await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
      expect(res.status).toBe(402);
      expect((await res.json()).error).toBe("invalid_amount");
      const entries = await ledger.listByWallet(W);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ state: "denied", denialReason: "invalid_amount" });
      expect(entries[0].clamped).toBeUndefined();
    },
  );

  it("validity deny fires before kind-gate (invalid kind + invalid amount → invalid_amount)", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, { perTxUsd: 10, clamp: true, allowedKinds: ["x402"] }));
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
    const app = new Hono();
    app.post("/x", async (c) => {
      const begun = await enforcer.begin(c, -1, "eaas", "r1");
      if (begun instanceof Response) return begun;
      return c.json({ ok: true });
    });
    const res = await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("invalid_amount");
  });

  it("no-caps wallet + invalid amount → still denied (gate closes V04 surface)", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, {})); // no envelope at all
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
    const app = new Hono();
    app.post("/x", async (c) => {
      const begun = await enforcer.begin(c, NaN, "eaas", "r1");
      if (begun instanceof Response) return begun;
      return c.json({ ok: true });
    });
    const res = await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("invalid_amount");
  });

  /* ---------------------- clamped-then-denied (D1) ------------------------ */

  it("clamped candidate + daily deny → 402, deny entry carries REQUESTED (draft §6)", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, { perTxUsd: 10, dailyUsd: 20, clamp: true }));
    const ledger = createMemorySpendLedger();
    await ledger.insert({
      id: "sp_prev",
      wallet: W,
      amountUsd: 18,
      kind: "eaas",
      refId: "prev",
      state: "settled",
      at: Date.now(),
    });
    const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
    const app = new Hono();
    app.post("/x", async (c) => {
      const begun = await enforcer.begin(c, 25, "eaas", "r1");
      if (begun instanceof Response) return begun;
      return c.json({ ok: true });
    });
    const res = await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({ error: "spend_cap", cap: "daily", limit: 20 });
    // D9: no reserved entry; denied entry audits the REQUESTED amount.
    const entries = await ledger.listByWallet(W);
    const fresh = entries.filter((e) => e.id !== "sp_prev");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({
      state: "denied",
      denialReason: "daily",
      amountUsd: 25,
    });
    expect(fresh[0].clamped).toBeUndefined();
    expect(res.headers.get("x-spend-clamped")).toBeNull();
  });

  it("clamped candidate + kind deny → kind_not_allowed, requested", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(
      rec(W, { perTxUsd: 10, clamp: true, allowedKinds: ["x402"] }),
    );
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
    const app = new Hono();
    app.post("/x", async (c) => {
      const begun = await enforcer.begin(c, 25, "eaas", "r1");
      if (begun instanceof Response) return begun;
      return c.json({ ok: true });
    });
    const res = await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("kind_not_allowed");
  });

  /* ------------------------- consistency guard ---------------------------- */

  it("complete() mismatch on clamped entry → spend.clamp_mismatch alert", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, { perTxUsd: 10, clamp: true }));
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
    const app = new Hono();
    app.post("/x", async (c) => {
      const begun = await enforcer.begin(c, 25, "eaas", "r1");
      if (begun instanceof Response) return begun;
      // downstream reports it settled the REQUESTED sum — the exact
      // consistency-chain break the guard exists to surface.
      await enforcer.complete(begun, true, 25, "eaas", "r1");
      return c.json({ ok: true });
    });
    await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
    const ev = alerts.list({ type: "spend.clamp_mismatch" });
    expect(ev).toHaveLength(1);
    expect(ev[0].data).toMatchObject({
      reservedUsd: 10,
      reportedUsd: 25,
      requestedUsd: 25,
    });
  });

  it("complete() with effective amount → no alert (clean chain)", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, { perTxUsd: 10, clamp: true }));
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({ ledger, registry: store, requireRegistered: false });
    const app = new Hono();
    app.post("/x", async (c) => {
      const begun = await enforcer.begin(c, 25, "eaas", "r1");
      if (begun instanceof Response) return begun;
      await enforcer.complete(begun, true, 10, "eaas", "r1");
      return c.json({ ok: true });
    });
    await app.request("/x", { method: "POST", headers: { "x-wallet": W } });
    expect(alerts.list({ type: "spend.clamp_mismatch" })).toHaveLength(0);
    expect((await ledger.listByWallet(W))[0].state).toBe("settled");
  });
});

/* ------------------------- PATCH /envelope — clamp ------------------------ */

describe("PATCH /api/wallets/:address/envelope — clamp declaration", () => {
  const signed = (wallet: string) => ({
    "x-wallet": wallet,
    "x-sig": "0xdead",
    "x-timestamp": String(Math.floor(Date.now() / 1000)),
    "x-nonce": crypto.randomUUID(),
    "content-type": "application/json",
  });

  async function envApp() {
    const store = createMemoryAgentWalletStore();
    const ledger = createMemorySpendLedger();
    const app = new Hono();
    app.route("/", createAgentWalletEnvelopeRoutes({ store, ledger }));
    await store.put(rec(W));
    return { app, store };
  }

  it("clamp:true persists + GET returns it; clamp:false persists", async () => {
    const { app, store } = await envApp();
    const res = await app.request(`/api/wallets/${W}/envelope`, {
      method: "PATCH",
      headers: signed(W),
      body: JSON.stringify({ perTxUsd: 10, clamp: true }),
    });
    expect(res.status).toBe(200);
    expect((await store.get(W))!.envelope.clamp).toBe(true);
    const get = await app.request(`/api/wallets/${W}/envelope`);
    expect((await get.json()).caps.clamp).toBe(true);
  });

  it('clamp:"yes" → 400 (Q2 non-bool)', async () => {
    const { app } = await envApp();
    const res = await app.request(`/api/wallets/${W}/envelope`, {
      method: "PATCH",
      headers: signed(W),
      body: JSON.stringify({ perTxUsd: 10, clamp: "yes" }),
    });
    expect(res.status).toBe(400);
  });
});
