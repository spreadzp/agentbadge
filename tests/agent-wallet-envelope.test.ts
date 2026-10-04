/**
 * SLICE-155-2 tests: spend envelope — caps, ledger transitions, deny UX,
 * PATCH/GET envelope routes, path gate, payer resolution.
 *
 * Covered (per spec acceptance):
 *  - per-tx/daily/weekly/monthly deny over cap → 402 spend_cap + fields
 *  - rolling daily window sums reserved+settled; released frees space
 *  - race: sequential reserves at boundary → second denied
 *  - ledger restart persistence (json impl reload)
 *  - PATCH/GET envelope: registrant ok, stranger 403, monotonic 400
 *  - gate middleware: registered wallet over cap → 402 before handler;
 *    unregistered → opt-in pass; REQUIRE_REGISTERED → 402
 *  - wallet resolution from PAYMENT-SIGNATURE authorization.from
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono, type Context } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMemorySpendLedger,
  createJsonSpendLedger,
  newSpendId,
  type SpendEntry,
} from "../src/server/lib/agent-wallet/ledger";
import {
  checkEnvelope,
  reserve,
  validateCaps,
} from "../src/server/lib/agent-wallet/envelope";
import {
  createSpendEnforcer,
  spendEnvelopeGate,
  initSpendEnforcer,
  withEnvelope,
  resolveSpendWallet,
} from "../src/server/lib/agent-wallet/enforcer";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../src/server/lib/agent-wallet/registry";
import { createAgentWalletEnvelopeRoutes } from "../src/server/routes/agent-wallet-envelope-api";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";
import {
  resetStoreForTesting,
  useMemoryStoreForTesting,
} from "../src/server/lib/venue/store";

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const W2 = "0x00000000000000000000000000000000000000b2" as `0x${string}`;

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

const entry = (
  over: Partial<SpendEntry> = {},
): SpendEntry => ({
  id: newSpendId(),
  wallet: W,
  amountUsd: 10,
  kind: "eaas",
  refId: "r1",
  state: "settled",
  at: Date.now(),
  ...over,
});

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
  resetVenueEventsForTests();
  initSpendEnforcer(null);
});
afterEach(() => {
  initSpendEnforcer(null);
  resetStoreForTesting();
  resetAgentAuthForTesting();
  resetVenueEventsForTests();
  resetDatabaseForTests();
  if (SAVED_DB === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB;
  resetConfigCache();
});

/* ------------------------------ caps validate ------------------------------ */

describe("validateCaps", () => {
  it("accepts numbers + numeric strings; rejects negative/NaN/non-monotonic", () => {
    expect(validateCaps({ perTxUsd: 5 })).toEqual({ perTxUsd: 5 });
    expect(validateCaps({ dailyUsd: "10" })).toEqual({ dailyUsd: 10 });
    expect(() => validateCaps({ perTxUsd: -1 })).toThrow(/non-negative/);
    expect(() => validateCaps({ dailyUsd: "abc" })).toThrow(/non-negative/);
    expect(() =>
      validateCaps({ dailyUsd: 5, weeklyUsd: 4 }),
    ).toThrow(/monotonic/);
    expect(validateCaps({})).toEqual({});
  });
});

/* ------------------------------- check/reserve ----------------------------- */

describe("checkEnvelope + reserve/settle/release", () => {
  it("per-tx cap deny: amount > cap → deny perTx", async () => {
    const l = createMemorySpendLedger();
    const v = await checkEnvelope(l, { perTxUsd: 5 }, W, 10);
    expect(v).toMatchObject({ allow: false });
    if (!v.allow) expect(v.deny.cap).toBe("perTx");
  });

  it("rolling daily window sums settled+reserved; over → deny daily", async () => {
    const l = createMemorySpendLedger();
    await l.insert(entry({ amountUsd: 60, at: Date.now() - 3600_000 }));
    await l.insert(entry({ amountUsd: 30, state: "reserved" }));
    const v = await checkEnvelope(l, { dailyUsd: 100 }, W, 15);
    expect(v).toMatchObject({ allow: false });
    if (!v.allow) {
      expect(v.deny.cap).toBe("daily");
      expect(v.deny.used).toBe(90);
      expect(v.deny.limit).toBe(100);
      expect(v.deny.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
  });

  it("weekly/monthly caps enforce over rolling windows; old entries ignored", async () => {
    const l = createMemorySpendLedger();
    // 3 days ago — inside weekly, outside daily.
    await l.insert(entry({ amountUsd: 80, at: Date.now() - 3 * 86_400_000 }));
    // 40 days ago — outside monthly.
    await l.insert(entry({ amountUsd: 500, at: Date.now() - 40 * 86_400_000 }));
    expect((await checkEnvelope(l, { dailyUsd: 100 }, W, 15)).allow).toBe(true);
    const w = await checkEnvelope(l, { weeklyUsd: 100 }, W, 25);
    expect(w).toMatchObject({ allow: false });
    if (!w.allow) expect(w.deny.cap).toBe("weekly");
    expect((await checkEnvelope(l, { monthlyUsd: 400 }, W, 10)).allow).toBe(true);
    const m = await checkEnvelope(l, { monthlyUsd: 90 }, W, 15);
    expect(m).toMatchObject({ allow: false });
    if (!m.allow) expect(m.deny.cap).toBe("monthly");
  });

  it("reserve→settle keeps usage; release frees it (failed payment doesn't eat cap)", async () => {
    const l = createMemorySpendLedger();
    const caps = { dailyUsd: 100 };
    const r = await reserve(l, caps, W, 60, "eaas", "v1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 60 reserved — next 50 over cap
    expect((await checkEnvelope(l, caps, W, 50)).allow).toBe(false);
    // release → space freed
    expect(await l.transition(r.entry.id, "released")).toBe(true);
    expect((await checkEnvelope(l, caps, W, 50)).allow).toBe(true);
    // settled stays counted; released does not transition again
    const r2 = await reserve(l, caps, W, 50, "eaas", "v2");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(await l.transition(r2.entry.id, "settled", "0xtx")).toBe(true);
    expect(await l.transition(r2.entry.id, "released")).toBe(false);
    expect((await checkEnvelope(l, caps, W, 60)).allow).toBe(false);
  });

  it("race: two boundary reserves — first wins, second denied", async () => {
    const l = createMemorySpendLedger();
    const caps = { dailyUsd: 100 };
    const a = await reserve(l, caps, W, 90, "eaas", "a");
    const b = await reserve(l, caps, W, 90, "eaas", "b");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.deny.cap).toBe("daily");
  });

  it("json ledger survives restart (fresh instance, same path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awl-"));
    const path = join(dir, "ledger.json");
    const a = createJsonSpendLedger(path);
    await a.insert(entry({ id: "sp_persist1", state: "reserved" }));
    const b = createJsonSpendLedger(path);
    expect(await b.listByWallet(W)).toHaveLength(1);
    expect(await b.transition("sp_persist1", "settled", "0xtx")).toBe(true);
    const c = createJsonSpendLedger(path);
    expect((await c.listByWallet(W))[0].state).toBe("settled");
    rmSync(dir, { recursive: true, force: true });
  });
});

/* ------------------------------- routes ----------------------------------- */

describe("PATCH/GET /api/wallets/:address/envelope", () => {
  const signed = (wallet: string) => ({
    "x-wallet": wallet,
    "x-sig": "0xdead",
    "x-timestamp": String(Math.floor(Date.now() / 1000)),
    "content-type": "application/json",
  });

  async function envApp() {
    const store = createMemoryAgentWalletStore();
    const ledger = createMemorySpendLedger();
    const app = new Hono();
    app.route("/", createAgentWalletEnvelopeRoutes({ store, ledger }));
    await store.put(rec(W));
    return { app, store, ledger };
  }

  it("PATCH registrant → 200 caps saved; GET shows caps+usage", async () => {
    const { app, store } = await envApp();
    const res = await app.request(`/api/wallets/${W}/envelope`, {
      method: "PATCH",
      headers: signed(W),
      body: JSON.stringify({ perTxUsd: 5, dailyUsd: 50 }),
    });
    expect(res.status).toBe(200);
    expect((await store.get(W))!.envelope).toEqual({ perTxUsd: 5, dailyUsd: 50 });

    const get = await app.request(`/api/wallets/${W}/envelope`);
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.caps.dailyUsd).toBe(50);
    expect(body.usage.daily.cap).toBe(50);
    expect(body.usage.perTx.cap).toBe(5);
  });

  it("PATCH stranger → 403; no sig → 401; non-monotonic → 400; unknown → 404", async () => {
    const { app } = await envApp();
    const deny = await app.request(`/api/wallets/${W}/envelope`, {
      method: "PATCH",
      headers: signed(W2),
      body: JSON.stringify({ dailyUsd: 5 }),
    });
    expect(deny.status).toBe(403);
    const nosig = await app.request(`/api/wallets/${W}/envelope`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dailyUsd: 5 }),
    });
    expect(nosig.status).toBe(401);
    const badCaps = await app.request(`/api/wallets/${W}/envelope`, {
      method: "PATCH",
      headers: signed(W),
      body: JSON.stringify({ dailyUsd: 100, weeklyUsd: 50 }),
    });
    expect(badCaps.status).toBe(400);
    const missing = await app.request(`/api/wallets/${W2}/envelope`, {
      method: "PATCH",
      headers: signed(W2),
      body: JSON.stringify({ dailyUsd: 5 }),
    });
    expect(missing.status).toBe(404);
  });

  it("GET usage reflects settled spend within window", async () => {
    const { app, store, ledger } = await envApp();
    await store.setEnvelope(W, { dailyUsd: 100 });
    await ledger.insert(entry({ amountUsd: 40 }));
    await ledger.insert(entry({ amountUsd: 10, state: "released" }));
    const res = await app.request(`/api/wallets/${W}/envelope`);
    const body = await res.json();
    expect(body.usage.daily.used).toBe(40); // released not counted
  });
});

/* --------------------------------- enforcer -------------------------------- */

describe("SpendEnforcer + gate + payer resolution", () => {
  async function enforcerApp(opts: {
    requireRegistered?: boolean;
    defaultCaps?: Record<string, number>;
    envelope?: Record<string, number>;
  }) {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, opts.envelope ?? {}));
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({
      ledger,
      registry: store,
      requireRegistered: opts.requireRegistered ?? false,
      ...(opts.defaultCaps ? { defaultCaps: opts.defaultCaps } : {}),
    });
    initSpendEnforcer(enforcer);
    const app = new Hono();
    app.use(
      "/api/pay",
      spendEnvelopeGate({ kind: "eaas", amountUsdFor: () => 25 }),
    );
    app.post("/api/pay", (c) => c.json({ paid: true }));
    return { app, ledger };
  }

  const pay = (app: Hono, wallet?: string) =>
    app.request("/api/pay", {
      method: "POST",
      headers: wallet ? { "x-wallet": wallet } : {},
    });

  it("over daily cap → 402 spend_cap before handler; under → 200 + settled", async () => {
    const { app, ledger } = await enforcerApp({ envelope: { dailyUsd: 40 } });
    const first = await pay(app, W);
    expect(first.status).toBe(200);
    // 25 used; next 25 → 50 > 40 → deny
    const second = await pay(app, W);
    expect(second.status).toBe(402);
    const body = await second.json();
    expect(body.error).toBe("spend_cap");
    expect(body.cap).toBe("daily");
    expect(body.used).toBe(25);
    expect(body.limit).toBe(40);
    expect(body.resetAt).toBeGreaterThan(0);
    // ledger: 1 settled, 1 denied (SLICE-155-11: cap denial is a durable entry)
    const entries = await ledger.listByWallet(W);
    expect(entries.map((e) => e.state).sort()).toEqual(["denied", "settled"]);
    expect(entries.find((e) => e.state === "denied")?.denialReason).toBe("daily");
  });

  it("unregistered wallet → opt-in pass (no caps); requireRegistered → 402", async () => {
    const { app } = await enforcerApp({});
    expect((await pay(app, W2)).status).toBe(200);

    const strict = await enforcerApp({ requireRegistered: true });
    const res = await pay(strict.app, W2);
    expect(res.status).toBe(402);
  });

  it("registered + defaultCaps (no record envelope) → caps apply", async () => {
    const { app } = await enforcerApp({ defaultCaps: { perTxUsd: 10 } });
    const res = await pay(app, W);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.cap).toBe("perTx");
  });

  it("payer from PAYMENT-SIGNATURE authorization.from (no x-wallet)", async () => {
    const { app, ledger } = await enforcerApp({ envelope: { dailyUsd: 30 } });
    const sig = Buffer.from(
      JSON.stringify({ payload: { authorization: { from: W } } }),
    ).toString("base64");
    const res = await app.request("/api/pay", {
      method: "POST",
      headers: { "payment-signature": sig },
    });
    expect(res.status).toBe(200);
    expect((await ledger.listByWallet(W)).map((e) => e.state)).toEqual(["settled"]);
    // second → 25+25 > 30 → deny
    const res2 = await app.request("/api/pay", {
      method: "POST",
      headers: { "payment-signature": sig },
    });
    expect(res2.status).toBe(402);
  });

  it("resolveSpendWallet prefers verified agentWallet ctx over headers", async () => {
    const app = new Hono();
    let seen: string | undefined;
    app.post("/x", async (c: Context) => {
      c.set("agentWallet", W2);
      seen = resolveSpendWallet(c);
      return c.json({ ok: true });
    });
    await app.request("/x", {
      method: "POST",
      headers: { "x-wallet": W },
    });
    expect(seen).toBe(W2.toLowerCase());
  });

  it("withEnvelope: fn failure releases reservation", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W, { dailyUsd: 100 }));
    const ledger = createMemorySpendLedger();
    const enforcer = createSpendEnforcer({
      ledger,
      registry: store,
      requireRegistered: false,
    });
    const app = new Hono();
    app.post("/x", async (c) => {
      const r = await withEnvelope(
        enforcer,
        c,
        { amountUsd: 25, kind: "eaas", refId: "t1" },
        async () => {
          throw new Error("payment blew up");
        },
      );
      void r;
      return c.json({ ok: true });
    });
    // fn throws — withEnvelope rethrows; route still returns via catch
    app.onError((err, c) => c.json({ err: err.message }, 500));
    const res = await app.request("/x", {
      method: "POST",
      headers: { "x-wallet": W },
    });
    expect(res.status).toBe(500);
    // reservation released — cap space freed
    const entries = await ledger.listByWallet(W);
    expect(entries[0].state).toBe("released");
  });
});
