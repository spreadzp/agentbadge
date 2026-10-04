/**
 * SLICE-176-7 tests: approval hold-path — платёж выше approvalAboveUsd
 * паркуется как pending intent вместо молчаливого прохода.
 *
 * Covered (per spec acceptance):
 *  - amount > threshold → 402 approval_required {approvalId, expiresAt,
 *    amountUsd, kind, action:"owner-approval-required"} + parked intent
 *  - boundary: amount == threshold → pass (reserve proceeds)
 *  - pending intents НЕ едят кап-пространство (ledger untouched on hold)
 *  - queue full → 402 approval_queue_full, ничего не паркуется
 *  - audit: approval.requested alert per parked intent
 *  - порядок веток: suspended → kind → caps → hold → reserve
 *    (kind_not_allowed и spend_cap wins над hold)
 *  - без approvals-dep → hold ветка неактивна (feature-off pass-through)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import { createMemorySpendLedger } from "../src/server/lib/agent-wallet/ledger";
import {
  createSpendEnforcer,
  spendEnvelopeGate,
  initSpendEnforcer,
  type SpendEnforcerDeps,
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

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const TTL = 3_600_000;

const rec = (envelope: SpendCaps): AgentWalletRecord => ({
  address: W,
  label: "x",
  kind: "eoa",
  envelope,
  registeredBy: W,
  createdAt: Date.now(),
  active: true,
});

interface Fixture {
  ledger: ReturnType<typeof createMemorySpendLedger>;
  approvals: ApprovalStore;
  alerts: SpendAlertStore;
  pay: (amountUsd: number) => Promise<Response>;
}

async function mkApp(
  envelope: SpendCaps,
  opts: { maxPending?: number; noApprovals?: boolean } = {},
): Promise<Fixture> {
  const store = createMemoryAgentWalletStore();
  await store.put(rec(envelope));
  const ledger = createMemorySpendLedger();
  const alerts = createMemorySpendAlertStore();
  initSpendAlerts({ store: alerts });
  const approvals = createMemoryApprovalStore(opts.maxPending ?? 20);
  const deps: SpendEnforcerDeps = {
    ledger,
    registry: store,
    requireRegistered: false,
    approvalTtlMs: TTL,
    ...(opts.noApprovals ? {} : { approvals }),
  };
  initSpendEnforcer(createSpendEnforcer(deps));
  const app = new Hono();
  app.use(
    "/api/pay",
    spendEnvelopeGate({
      kind: "eaas",
      amountUsdFor: (c) => Number(c.req.header("x-amount") ?? 0),
    }),
  );
  app.post("/api/pay", (c) => c.json({ paid: true }));
  const pay = async (amountUsd: number) =>
    app.request("/api/pay", {
      method: "POST",
      headers: { "x-wallet": W, "x-amount": String(amountUsd) },
    });
  return { ledger, approvals, alerts, pay };
}

beforeEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});
afterEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});

describe("approval hold-path (176-7)", () => {
  it("amount > approvalAboveUsd → 402 approval_required + parked intent", async () => {
    const { ledger, approvals, pay } = await mkApp({ approvalAboveUsd: 10 });
    const res = await pay(25);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("approval_required");
    expect(body.action).toBe("owner-approval-required");
    expect(body.approvalId).toMatch(/^ap_[0-9a-f]{16}$/);
    expect(body.amountUsd).toBe(25);
    expect(body.kind).toBe("eaas");
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + TTL + 1000);

    // parked pending intent in the approval store
    const a = await approvals.get(body.approvalId);
    expect(a?.state).toBe("pending");
    expect(a?.wallet).toBe(W);
    expect(a?.amountUsd).toBe(25);
    expect(a?.kind).toBe("eaas");

    // ledger untouched — pending не ест кап-пространство
    expect(await ledger.listByWallet(W)).toEqual([]);
  });

  it("boundary: amount == threshold → pass (reserve proceeds)", async () => {
    const { ledger, approvals, pay } = await mkApp({ approvalAboveUsd: 10 });
    const res = await pay(10);
    expect(res.status).toBe(200);
    expect(await approvals.countPending(W)).toBe(0);
    const entries = await ledger.listByWallet(W);
    expect(entries.length).toBe(1);
    // gate reserves then completes → settled after 200
    expect(entries[0].state).toBe("settled");
  });

  it("amount < threshold → normal reserve, no approval", async () => {
    const { approvals, pay } = await mkApp({ approvalAboveUsd: 10 });
    const res = await pay(3);
    expect(res.status).toBe(200);
    expect(await approvals.countPending(W)).toBe(0);
  });

  it("queue full → 402 approval_queue_full, ничего не паркуется сверх капа", async () => {
    const { approvals, pay } = await mkApp(
      { approvalAboveUsd: 10 },
      { maxPending: 1 },
    );
    const first = await pay(20);
    expect(first.status).toBe(402);
    expect((await first.json()).error).toBe("approval_required");
    expect(await approvals.countPending(W)).toBe(1);

    const second = await pay(30);
    expect(second.status).toBe(402);
    const body = await second.json();
    expect(body.error).toBe("approval_queue_full");
    expect(await approvals.countPending(W)).toBe(1);
  });

  it("approval.requested alert per parked intent", async () => {
    const { approvals, alerts, pay } = await mkApp({ approvalAboveUsd: 10 });
    const res = await pay(50);
    const body = await res.json();
    const evs = await alerts.list({ type: "approval.requested" });
    expect(evs.length).toBe(1);
    expect(evs[0].data.approvalId).toBe(body.approvalId);
    expect(evs[0].data.amountUsd).toBe(50);
    expect(evs[0].data.kind).toBe("eaas");
    expect(await approvals.get(body.approvalId)).not.toBeNull();
  });

  it("refId попадает в parked intent", async () => {
    const { approvals, pay } = await mkApp({ approvalAboveUsd: 1 });
    const res = await pay(5);
    const body = await res.json();
    const a = await approvals.get(body.approvalId);
    expect(a?.refId).toMatch(/^eaas:/);
  });

  it("kind_not_allowed wins over hold (explicit violation first)", async () => {
    const { approvals, pay } = await mkApp({
      approvalAboveUsd: 1,
      allowedKinds: ["x402"],
    });
    const res = await pay(99);
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("kind_not_allowed");
    expect(await approvals.countPending(W)).toBe(0);
  });

  it("hard cap deny wins over hold — dailyUsd breach → spend_cap", async () => {
    const { ledger, approvals, pay } = await mkApp({
      approvalAboveUsd: 5,
      dailyUsd: 10,
    });
    const res = await pay(50); // > threshold AND > dailyUsd
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("spend_cap");
    expect(body.cap).toBe("daily");
    expect(await approvals.countPending(W)).toBe(0);
    const denied = (await ledger.listByWallet(W)).find(
      (e) => e.state === "denied",
    );
    expect(denied?.denialReason).toBe("daily");
  });

  it("permit replay: second hold while one pending → parks separately", async () => {
    const { approvals, pay } = await mkApp({ approvalAboveUsd: 10 });
    const r1 = await pay(15);
    const r2 = await pay(16);
    expect((await r1.json()).approvalId).not.toBe((await r2.json()).approvalId);
    expect(await approvals.countPending(W)).toBe(2);
  });

  it("no approvals dep → hold branch inactive, payment reserves", async () => {
    const { ledger, pay } = await mkApp(
      { approvalAboveUsd: 1 },
      { noApprovals: true },
    );
    const res = await pay(99);
    expect(res.status).toBe(200);
    const entries = await ledger.listByWallet(W);
    expect(entries.some((e) => e.state === "settled")).toBe(true);
  });
});
