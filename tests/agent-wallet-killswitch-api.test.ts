/**
 * SLICE-176-5 tests: kill-switch API — suspend/resume endpoints.
 *
 * Covered (per spec acceptance):
 *  - POST /api/wallets/:addr/suspend → 200 {suspended, suspendedAt,
 *    suspendedBy, envelope}; платёж сразу deny spend_suspended
 *  - POST /api/wallets/:addr/resume → 200 {suspended:false}, платёж ок
 *  - Чужая подпись → 403, состояние не меняется; без sig → 401;
 *    unknown wallet → 404; невалидный addr → 400
 *  - Идемпотентность: suspend suspended → 200
 *  - Audit: wallet.suspended / wallet.resumed alerts с actor
 *  - Suspend освобождает активные резервы (оркестрация 176-4 через API)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import { createAgentWalletRoutes } from "../src/server/routes/agent-wallet-api";
import { createAgentWalletKillswitchRoutes } from "../src/server/routes/agent-wallet-killswitch-api";
import { createMemoryAgentWalletStore } from "../src/server/lib/agent-wallet/registry";
import { createMemorySpendLedger, windowUsage } from "../src/server/lib/agent-wallet/ledger";
import {
  createSpendEnforcer,
  spendEnvelopeGate,
  initSpendEnforcer,
} from "../src/server/lib/agent-wallet/enforcer";
import {
  createMemorySpendAlertStore,
  initSpendAlerts,
} from "../src/server/lib/agent-wallet/audit";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";
import {
  resetStoreForTesting,
  useMemoryStoreForTesting,
} from "../src/server/lib/venue/store";
import { createVenue } from "../src/server/lib/venue/venues";
import { addVenueMember } from "../src/server/lib/venue/members";

const OWNER = "0x00000000000000000000000000000000000000aa";
const W_AGENT = "0x00000000000000000000000000000000000000b1";
const STRANGER = "0x00000000000000000000000000000000000000dd";

const signedHeaders = (wallet: string) => ({
  "x-wallet": wallet,
  "x-sig": "0xdead",
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
  "content-type": "application/json",
});

/** App: wallets routes + gated pay route на общих store/ledger. */
function mkApp() {
  const store = createMemoryAgentWalletStore();
  const ledger = createMemorySpendLedger();
  const alertStore = createMemorySpendAlertStore();
  initSpendAlerts({ store: alertStore });
  initSpendEnforcer(
    createSpendEnforcer({ ledger, registry: store, requireRegistered: false }),
  );
  const app = new Hono();
  app.route(
    "/",
    createAgentWalletRoutes({
      store,
      chain: "ARC",
      rateRpm: 60,
    }),
  );
  app.route("/", createAgentWalletKillswitchRoutes({ store, ledger }));
  app.use("/api/pay", spendEnvelopeGate({ kind: "eaas", amountUsdFor: () => 1 }));
  app.post("/api/pay", (c) => c.json({ paid: true }));
  return { app, store, ledger, alertStore };
}

const post = (app: Hono, path: string, wallet = W_AGENT) =>
  app.request(path, { method: "POST", headers: signedHeaders(wallet) });

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
  initSpendEnforcer(null);
  initSpendAlerts(null);
});
afterEach(() => {
  resetStoreForTesting();
  resetAgentAuthForTesting();
  resetDatabaseForTests();
  initSpendEnforcer(null);
  initSpendAlerts(null);
});

/** Регистрация helper: wallet регистрирует сам себя. */
async function register(app: Hono, wallet: string) {
  return app.request("/api/wallets", {
    method: "POST",
    headers: signedHeaders(wallet),
    body: JSON.stringify({ address: wallet, label: "bot", kind: "eoa" }),
  });
}

describe("suspend/resume endpoints", () => {
  it("suspend → 200 {suspended:true, suspendedAt, suspendedBy, envelope} → платёж 402 spend_suspended", async () => {
    const { app, store } = mkApp();
    await register(app, W_AGENT);
    const res = await post(app, `/api/wallets/${W_AGENT}/suspend`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suspended).toBe(true);
    expect(body.suspendedAt).toBeGreaterThan(0);
    expect(body.suspendedBy).toBe(W_AGENT);
    expect(body.envelope).toBeDefined();
    expect((await store.get(W_AGENT))?.suspended).toBe(true);

    const pay = await app.request("/api/pay", {
      method: "POST",
      headers: signedHeaders(W_AGENT),
    });
    expect(pay.status).toBe(402);
    expect((await pay.json()).error).toBe("spend_suspended");
  });

  it("resume → 200 {suspended:false}, платёж снова ок", async () => {
    const { app } = mkApp();
    await register(app, W_AGENT);
    await post(app, `/api/wallets/${W_AGENT}/suspend`);
    const res = await post(app, `/api/wallets/${W_AGENT}/resume`);
    expect(res.status).toBe(200);
    expect((await res.json()).suspended).toBe(false);

    const pay = await app.request("/api/pay", {
      method: "POST",
      headers: signedHeaders(W_AGENT),
    });
    expect(pay.status).toBe(200);
  });

  it("чужая подпись → 403, состояние не меняется", async () => {
    const { app, store } = mkApp();
    await register(app, W_AGENT);
    const res = await post(app, `/api/wallets/${W_AGENT}/suspend`, STRANGER);
    expect(res.status).toBe(403);
    expect((await store.get(W_AGENT))?.suspended).toBeFalsy();
  });

  it("без sig → 401; unknown wallet → 404; bad addr → 400", async () => {
    const { app } = mkApp();
    await register(app, W_AGENT);
    const noSig = await app.request(`/api/wallets/${W_AGENT}/suspend`, {
      method: "POST",
    });
    expect(noSig.status).toBe(401);
    const unknown = await post(app, `/api/wallets/${STRANGER}/suspend`, STRANGER);
    expect(unknown.status).toBe(404);
    const badAddr = await post(app, "/api/wallets/0xzz/suspend", W_AGENT);
    expect(badAddr.status).toBe(400);
  });

  it("идемпотентность: suspend suspended → 200", async () => {
    const { app } = mkApp();
    await register(app, W_AGENT);
    await post(app, `/api/wallets/${W_AGENT}/suspend`);
    const again = await post(app, `/api/wallets/${W_AGENT}/suspend`);
    expect(again.status).toBe(200);
    expect((await again.json()).suspended).toBe(true);
  });

  it("audit: wallet.suspended + wallet.resumed alerts с actor", async () => {
    const { app, alertStore } = mkApp();
    await register(app, W_AGENT);
    await post(app, `/api/wallets/${W_AGENT}/suspend`);
    await post(app, `/api/wallets/${W_AGENT}/resume`);

    const susp = await alertStore.list({ type: "wallet.suspended" });
    expect(susp.length).toBe(1);
    expect(susp[0].data.actor).toBe(W_AGENT);
    const resm = await alertStore.list({ type: "wallet.resumed" });
    expect(resm.length).toBe(1);
    expect(resm[0].data.actor).toBe(W_AGENT);
  });

  it("suspend через API освобождает активные резервы", async () => {
    const { app, ledger } = mkApp();
    await register(app, W_AGENT);
    // занимаем резерв через прямой reserve-вызов (как gate до suspend)
    const { reserve } = await import("../src/server/lib/agent-wallet/envelope");
    const r = await reserve(ledger, { dailyUsd: 10 }, W_AGENT, 5, "eaas", "r1");
    expect(r.ok).toBe(true);
    expect((await windowUsage(ledger, W_AGENT, 86_400)).used).toBe(5);

    await post(app, `/api/wallets/${W_AGENT}/suspend`);
    expect((await windowUsage(ledger, W_AGENT, 86_400)).used).toBe(0);
    const entries = await ledger.listByWallet(W_AGENT);
    expect(entries.find((e) => e.refId === "r1")?.state).toBe("released");
  });

  it("venue admin может suspend'ить wallet своей venue (как в DELETE)", async () => {
    const { app, store } = mkApp();
    const v = createVenue({
      name: "Biz",
      slug: `biz-${Math.random().toString(16).slice(2, 8)}`,
      kind: "business",
      ownerWallet: OWNER,
    });
    const W_MEMBER = "0x00000000000000000000000000000000000000c1";
    addVenueMember(v.id, { wallet: W_MEMBER, role: "provider", addedBy: OWNER });
    await store.put({
      address: W_AGENT,
      label: "x",
      kind: "eoa",
      envelope: {},
      venueId: v.id,
      registeredBy: W_MEMBER.toLowerCase() as `0x${string}`,
      createdAt: Date.now(),
      active: true,
    });
    // venue owner (admin) suspend — не registrant
    const res = await post(app, `/api/wallets/${W_AGENT}/suspend`, OWNER);
    expect(res.status).toBe(200);
    expect((await store.get(W_AGENT))?.suspended).toBe(true);
  });
});
