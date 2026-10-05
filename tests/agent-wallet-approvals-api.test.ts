/**
 * SLICE-176-9 tests: approval API — owner list/approve/reject
 * для припаркованных intents (human-in-the-loop канал #1).
 *
 * Covered (per spec acceptance):
 *  - GET /api/wallets/:addr/approvals?state=&limit=&cursor=
 *  - POST .../approvals/:id/approve → approved + expiresAt = now+TTL
 *  - POST .../approvals/:id/reject  → rejected (reason опционален)
 *  - auth: 401 без sig, 403 чужой signer, owner/registrant ok
 *  - 404 чужой/несущ. id (no leak); 409 уже решён / expired
 *  - approval.decided audit alert {approvalId, decision, actor}
 *  - полный цикл: hold → list → approve → retry → 200 settle
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
import { createAgentWalletApprovalsRoutes } from "../src/server/routes/agent-wallet-approvals-api";
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

const OWNER = "0x00000000000000000000000000000000000000aa";
const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const STRANGER = "0x00000000000000000000000000000000000000dd";
const TTL = 3_600_000;

const signedHeaders = (wallet: string) => ({
  "x-wallet": wallet,
  "x-sig": "0xdead",
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
  "content-type": "application/json",
});

const rec = (): AgentWalletRecord => ({
  address: W,
  label: "x",
  kind: "eoa",
  envelope: { approvalAboveUsd: 10 },
  registeredBy: OWNER as `0x${string}`,
  createdAt: Date.now(),
  active: true,
});

interface Fixture {
  app: Hono;
  ledger: ReturnType<typeof createMemorySpendLedger>;
  approvals: ApprovalStore;
  alerts: SpendAlertStore;
  /** реальный hold через gate → parked approval id */
  hold: (amountUsd?: number) => Promise<string>;
}

function mkApp(): Fixture {
  const store = createMemoryAgentWalletStore();
  void store.put(rec());
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
  app.route(
    "/",
    createAgentWalletApprovalsRoutes({
      store,
      approvals,
      approvalTtlMs: TTL,
    }),
  );
  const hold = async (amountUsd = 25): Promise<string> => {
    // spin to a fresh ms boundary → distinct createdAt → stable desc order
    const t0 = Date.now();
    while (Date.now() === t0) {
      await new Promise((r) => setImmediate(r));
    }
    const res = await app.request("/api/pay", {
      method: "POST",
      headers: {
        "x-wallet": W,
        "x-amount": String(amountUsd),
        "x-ref": "job-1",
      },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("approval_required");
    return body.approvalId as string;
  };
  return { app, ledger, approvals, alerts, hold };
}

const get = (app: Hono, path: string, wallet = OWNER) =>
  app.request(path, { method: "GET", headers: signedHeaders(wallet) });
const post = (app: Hono, path: string, wallet = OWNER, body?: object) =>
  app.request(path, {
    method: "POST",
    headers: signedHeaders(wallet),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
});
afterEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
  resetStoreForTesting();
  resetAgentAuthForTesting();
  resetDatabaseForTests();
});

describe("GET /api/wallets/:addr/approvals", () => {
  it("list pending intents (newest first) + поля записи", async () => {
    const f = mkApp();
    const id1 = await f.hold(20);
    const id2 = await f.hold(30);
    const res = await get(f.app, `/api/wallets/${W}/approvals`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approvals.length).toBe(2);
    expect(body.approvals[0].id).toBe(id2); // newest first
    expect(body.approvals[1].id).toBe(id1);
    const a = body.approvals[0];
    expect(a.wallet.toLowerCase()).toBe(W);
    expect(a.amountUsd).toBe(30);
    expect(a.kind).toBe("eaas");
    expect(a.refId).toBe("job-1");
    expect(a.state).toBe("pending");
    expect(a.expiresAt).toBeGreaterThan(Date.now());
  });

  it("state-фильтр: ?state=approved отдаёт только approved", async () => {
    const f = mkApp();
    const id = await f.hold();
    await f.approvals.decide(id, "approve", OWNER);
    const res = await get(f.app, `/api/wallets/${W}/approvals?state=approved`);
    const body = await res.json();
    expect(body.approvals.map((a: { id: string }) => a.id)).toEqual([id]);
    const pend = await get(f.app, `/api/wallets/${W}/approvals?state=pending`);
    expect((await pend.json()).approvals.length).toBe(0);
  });

  it("cursor pagination: limit=1 → nextCursor → вторая страница", async () => {
    const f = mkApp();
    const id1 = await f.hold(20);
    const id2 = await f.hold(30);
    const p1 = await get(f.app, `/api/wallets/${W}/approvals?limit=1`);
    const b1 = await p1.json();
    expect(b1.approvals.length).toBe(1);
    expect(b1.approvals[0].id).toBe(id2);
    expect(b1.nextCursor).toBe(id2);
    const p2 = await get(
      f.app,
      `/api/wallets/${W}/approvals?limit=1&cursor=${b1.nextCursor}`,
    );
    const b2 = await p2.json();
    expect(b2.approvals.map((a: { id: string }) => a.id)).toEqual([id1]);
    expect(b2.nextCursor).toBeNull();
  });

  it("401 без signature headers", async () => {
    const f = mkApp();
    const res = await f.app.request(`/api/wallets/${W}/approvals`);
    expect(res.status).toBe(401);
  });

  it("403 stranger signer (не owner)", async () => {
    const f = mkApp();
    const res = await get(f.app, `/api/wallets/${W}/approvals`, STRANGER);
    expect(res.status).toBe(403);
  });

  it("404 unregistered wallet; 400 invalid address", async () => {
    const f = mkApp();
    const res = await get(
      f.app,
      "/api/wallets/0x00000000000000000000000000000000000000ee/approvals",
    );
    expect(res.status).toBe(404);
    const bad = await get(f.app, "/api/wallets/notanaddr/approvals");
    expect(bad.status).toBe(400);
  });
});

describe("POST .../approvals/:id/approve|reject", () => {
  it("approve → state approved + expiresAt=now+TTL + approval.decided alert", async () => {
    const f = mkApp();
    const id = await f.hold();
    const before = await f.approvals.get(id);

    const res = await post(f.app, `/api/wallets/${W}/approvals/${id}/approve`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approval.state).toBe("approved");
    expect(body.approval.decidedBy).toBe(OWNER.toLowerCase());
    expect(body.approval.expiresAt).toBeGreaterThan(before!.expiresAt - 1);

    const evs = await f.alerts.list({ type: "approval.decided" });
    expect(evs.length).toBe(1);
    expect(evs[0].data.approvalId).toBe(id);
    expect(evs[0].data.decision).toBe("approved");
    expect(evs[0].data.actor).toBe(OWNER.toLowerCase());
  });

  it("reject → rejected + reason в audit data", async () => {
    const f = mkApp();
    const id = await f.hold();
    const res = await post(
      f.app,
      `/api/wallets/${W}/approvals/${id}/reject`,
      OWNER,
      { reason: "too expensive" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approval.state).toBe("rejected");
    const evs = await f.alerts.list({ type: "approval.decided" });
    expect(evs[0].data.decision).toBe("rejected");
    expect(evs[0].data.reason).toBe("too expensive");
  });

  it("404 чужой approval (permit другого кошелька — без утечки)", async () => {
    const f = mkApp();
    const foreign = await f.approvals.park({
      wallet: "0x00000000000000000000000000000000000000ff",
      amountUsd: 5,
      kind: "eaas",
      refId: "x",
      expiresAt: Date.now() + TTL,
    });
    const res = await post(
      f.app,
      `/api/wallets/${W}/approvals/${foreign.id}/approve`,
    );
    expect(res.status).toBe(404);
  });

  it("404 несуществующий id", async () => {
    const f = mkApp();
    const res = await post(
      f.app,
      `/api/wallets/${W}/approvals/ap_deadbeef/approve`,
    );
    expect(res.status).toBe(404);
  });

  it("409 уже решён; 409 expired-pending", async () => {
    const f = mkApp();
    const id = await f.hold();
    await f.approvals.decide(id, "reject", OWNER);
    const res = await post(f.app, `/api/wallets/${W}/approvals/${id}/approve`);
    expect(res.status).toBe(409);
    const b = await res.json();
    expect(b.code).toBe("approval_already_decided");

    const stale = await f.approvals.park({
      wallet: W,
      amountUsd: 25,
      kind: "eaas",
      refId: "old",
      expiresAt: Date.now() - 1,
    });
    const res2 = await post(
      f.app,
      `/api/wallets/${W}/approvals/${stale.id}/approve`,
    );
    expect(res2.status).toBe(409);
  });

  it("401 без sig; 403 stranger на approve", async () => {
    const f = mkApp();
    const id = await f.hold();
    const res = await f.app.request(
      `/api/wallets/${W}/approvals/${id}/approve`,
      { method: "POST" },
    );
    expect(res.status).toBe(401);
    const res2 = await post(
      f.app,
      `/api/wallets/${W}/approvals/${id}/approve`,
      STRANGER,
    );
    expect(res2.status).toBe(403);
  });
});

describe("полный цикл (acceptance)", () => {
  it("hold → list → approve → retry same ref → 200 settle", async () => {
    const f = mkApp();
    const id = await f.hold();
    const listed = await get(f.app, `/api/wallets/${W}/approvals`);
    expect((await listed.json()).approvals[0].id).toBe(id);

    await post(f.app, `/api/wallets/${W}/approvals/${id}/approve`);

    const retry = await f.app.request("/api/pay", {
      method: "POST",
      headers: {
        "x-wallet": W,
        "x-amount": "25",
        "x-ref": "job-1",
      },
    });
    expect(retry.status).toBe(200);
    const entries = await f.ledger.listByWallet(W);
    expect(entries[0].state).toBe("settled");
  });
});
