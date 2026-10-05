/**
 * SLICE-176-12 e2e: all four owner controls driven end-to-end through
 * the real HTTP routes — register → envelope → gated pay → approvals API
 * → killswitch → audit feed — on shared memory stores.
 *
 * Covered (per spec acceptance):
 *  - full-flow: hold (approval_required) → approve → retry → settle →
 *    audit shows requested → decided → consumed (+ entry settled)
 *  - suspend mid-flow: parked permit survives suspension; pays deny with
 *    spend_suspended while suspended; resume → consume → 200
 *  - velocity deny: maxTxPerHour=1 → 2nd pay → 402 velocity_tx + alert
 *  - kind deny: allowedKinds excludes kind → 402 kind_not_allowed + alert
 *  - cap deny: perTxUsd exceeded → 402 spend_cap + alert
 *  - audit completeness: every control event lands in the alerts feed
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import { createMemorySpendLedger } from "../src/server/lib/agent-wallet/ledger";
import {
  createSpendEnforcer,
  spendEnvelopeGate,
  initSpendEnforcer,
} from "../src/server/lib/agent-wallet/enforcer";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
  type SpendCaps,
} from "../src/server/lib/agent-wallet/registry";
import {
  createMemorySpendAlertStore,
  initSpendAlerts,
  type SpendAlertStore,
} from "../src/server/lib/agent-wallet/audit";
import {
  createMemoryApprovalStore,
  type ApprovalStore,
} from "../src/server/lib/agent-wallet/approvals";
import { createAgentWalletRoutes } from "../src/server/routes/agent-wallet-api";
import { createAgentWalletKillswitchRoutes } from "../src/server/routes/agent-wallet-killswitch-api";
import { createAgentWalletApprovalsRoutes } from "../src/server/routes/agent-wallet-approvals-api";
import { createSpendAuditRoutes } from "../src/server/routes/agent-wallet-audit-api";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { useMemoryStoreForTesting } from "../src/server/lib/venue/store";

const OWNER = "0x00000000000000000000000000000000000000aa";
const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const TTL = 3_600_000;

const signedHeaders = (wallet: string) => ({
  "x-wallet": wallet,
  "x-sig": "0xdead",
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
  "content-type": "application/json",
});

interface Fixture {
  app: Hono;
  ledger: ReturnType<typeof createMemorySpendLedger>;
  approvals: ApprovalStore;
  alerts: SpendAlertStore;
  pay: (amountUsd: number, ref?: string) => Promise<Response>;
  audit: () => Promise<{ entries: unknown[]; alerts: { type: string }[] }>;
}

function mkApp(envelope: SpendCaps): Fixture {
  const store = createMemoryAgentWalletStore();
  const rec: AgentWalletRecord = {
    address: W,
    label: "e2e",
    kind: "eoa",
    envelope,
    registeredBy: OWNER as `0x${string}`,
    createdAt: Date.now(),
    active: true,
  };
  void store.put(rec);
  const ledger = createMemorySpendLedger();
  const alerts = createMemorySpendAlertStore();
  initSpendAlerts({ store: alerts });
  const approvals = createMemoryApprovalStore();
  initSpendEnforcer(
    createSpendEnforcer({
      ledger,
      registry: store,
      requireRegistered: false,
      approvals,
      approvalTtlMs: TTL,
    }),
  );
  const app = new Hono();
  app.use(
    "/api/pay",
    spendEnvelopeGate({
      kind: "eaas",
      amountUsdFor: (c) => Number(c.req.header("x-amount") ?? 0),
      refIdFor: (c) => c.req.header("x-ref"),
    }),
  );
  app.post("/api/pay", (c) => c.json({ paid: true }));
  app.route("/", createAgentWalletRoutes({ store, chain: "ARC", rateRpm: 60 }));
  app.route("/", createAgentWalletKillswitchRoutes({ store, ledger }));
  app.route(
    "/",
    createAgentWalletApprovalsRoutes({ store, approvals, approvalTtlMs: TTL }),
  );
  app.route(
    "/",
    createSpendAuditRoutes({ store, ledger, alerts: () => alerts }),
  );
  const pay = async (amountUsd: number, ref = "job-1") =>
    await app.request("/api/pay", {
      method: "POST",
      headers: { "x-wallet": W, "x-amount": String(amountUsd), "x-ref": ref },
    });
  const audit = async () => {
    const res = await app.request(`/api/wallets/${W}/audit`, {
      headers: signedHeaders(OWNER),
    });
    expect(res.status).toBe(200);
    return res.json();
  };
  return { app, ledger, approvals, alerts, pay, audit };
}

const postSigned = (app: Hono, path: string, wallet = OWNER, body?: object) =>
  app.request(path, {
    method: "POST",
    headers: signedHeaders(wallet),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

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
  resetAgentAuthForTesting();
  resetDatabaseForTests();
  initSpendEnforcer(null);
  initSpendAlerts(null);
});

describe("176-12 e2e: owner controls", () => {
  it("full-flow: park → approve → retry → settle → audit trail", async () => {
    const f = mkApp({ approvalAboveUsd: 10 });
    // 1. over-threshold pay parks instead of spending
    const hold = await f.pay(25);
    expect(hold.status).toBe(402);
    const held = await hold.json();
    expect(held.error).toBe("approval_required");
    expect(held.approvalId).toMatch(/^ap_/);
    // pending intent never touched the cap
    expect((await f.ledger.listByWallet(W)).length).toBe(0);
    // 2. owner sees it in the queue and approves
    const list = await f.app.request(
      `/api/wallets/${W}/approvals?state=pending`,
      { headers: signedHeaders(OWNER) },
    );
    expect((await list.json()).approvals[0].id).toBe(held.approvalId);
    const ok = await postSigned(
      f.app,
      `/api/wallets/${W}/approvals/${held.approvalId}/approve`,
    );
    expect(ok.status).toBe(200);
    // 3. retry same ref → permit consumed atomically → settle
    const retry = await f.pay(25);
    expect(retry.status).toBe(200);
    const entries = await f.ledger.listByWallet(W);
    expect(entries[0].state).toBe("settled");
    // 4. audit trail: requested → decided → consumed
    const { alerts } = await f.audit();
    const types = alerts.map((a) => a.type);
    expect(types).toContain("approval.requested");
    expect(types).toContain("approval.decided");
    expect(types).toContain("approval.consumed");
  });

  it("suspend mid-flow: parked permit survives; resume → consume", async () => {
    const f = mkApp({ approvalAboveUsd: 10 });
    const held = await (await f.pay(25)).json();
    expect(held.error).toBe("approval_required");
    // suspend — new intents denied instantly, parked permit untouched
    const sus = await postSigned(f.app, `/api/wallets/${W}/suspend`);
    expect(sus.status).toBe(200);
    const denied = await f.pay(25);
    expect((await denied.json()).error).toBe("spend_suspended");
    // owner may still decide while suspended — approval not wasted
    await postSigned(f.app, `/api/wallets/${W}/approvals/${held.approvalId}/approve`);
    const stillDenied = await f.pay(25);
    expect((await stillDenied.json()).error).toBe("spend_suspended");
    // resume → permit consumes → settle
    await postSigned(f.app, `/api/wallets/${W}/resume`);
    expect((await f.pay(25)).status).toBe(200);
    const { alerts } = await f.audit();
    const types = alerts.map((a) => a.type);
    for (const t of [
      "wallet.suspended",
      "wallet.suspended_deny",
      "wallet.resumed",
      "approval.consumed",
    ]) {
      expect(types).toContain(t);
    }
  });

  it("velocity deny: maxTxPerHour=1 → second pay 402 velocity_tx", async () => {
    const f = mkApp({ maxTxPerHour: 1 });
    expect((await f.pay(1, "r1")).status).toBe(200);
    const deny = await f.pay(1, "r2");
    expect(deny.status).toBe(402);
    expect((await deny.json()).error).toBe("velocity_tx");
    const { alerts } = await f.audit();
    expect(alerts.map((a) => a.type)).toContain("spend.velocity_denied");
  });

  it("kind deny: allowedKinds excludes eaas → 402 kind_not_allowed", async () => {
    const f = mkApp({ allowedKinds: ["x402"] });
    const res = await f.pay(1);
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("kind_not_allowed");
    const { alerts } = await f.audit();
    expect(alerts.map((a) => a.type)).toContain("spend.kind_denied");
  });

  it("cap deny: perTxUsd exceeded → 402 spend_cap", async () => {
    const f = mkApp({ perTxUsd: 0.5 });
    const res = await f.pay(1);
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("spend_cap");
    const { alerts } = await f.audit();
    expect(alerts.map((a) => a.type)).toContain("spend.cap_denied");
  });
});
