/**
 * SLICE-176-8 tests: permit consume-path — approved permit даёт
 * одноразовый pass на retry, consume() атомарен.
 *
 * Covered (per spec acceptance):
 *  - approve → retry same (wallet,amountUsd,kind,refId) → 200 + settled
 *  - consume → approval.consumed alert {approvalId, spendId}
 *  - одноразовость: второй retry того же tuple → 402 (новый hold)
 *  - consume-race: два параллельных retry → ровно один проходит
 *  - expired/rejected permit → игнорируется → новый hold
 *  - mismatch refId/amount → не совпадает → новый hold, permit цел
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
  pay: (amountUsd: number, ref?: string) => Promise<Response>;
}

async function mkApp(envelope: SpendCaps): Promise<Fixture> {
  const store = createMemoryAgentWalletStore();
  await store.put(rec(envelope));
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
      // retry carries the same ref — permit match key
      refIdFor: (c) => c.req.header("x-ref"),
    }),
  );
  app.post("/api/pay", (c) => c.json({ paid: true }));
  const pay = async (amountUsd: number, ref = "job-1") =>
    app.request("/api/pay", {
      method: "POST",
      headers: { "x-wallet": W, "x-amount": String(amountUsd), "x-ref": ref },
    });
  return { ledger, approvals, alerts, pay };
}

/** Park via live request then approve it. Returns approval id. */
async function parkThenApprove(f: Fixture, amount: number, ref: string) {
  const held = await f.pay(amount, ref);
  expect(held.status).toBe(402);
  const body = await held.json();
  expect(body.error).toBe("approval_required");
  const ok = await f.approvals.decide(body.approvalId, "approve", "owner");
  expect(ok).toBe(true);
  return body.approvalId as string;
}

beforeEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});
afterEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});

describe("permit consume-path (176-8)", () => {
  it("approve → retry → 200 settle + approval.consumed alert", async () => {
    const f = await mkApp({ approvalAboveUsd: 10 });
    const id = await parkThenApprove(f, 25, "job-1");

    const res = await f.pay(25, "job-1");
    expect(res.status).toBe(200);
    const a = await f.approvals.get(id);
    expect(a?.state).toBe("consumed");
    expect(a?.consumedAt).toBeGreaterThan(0);

    const entries = await f.ledger.listByWallet(W);
    expect(entries.length).toBe(1);
    expect(entries[0].state).toBe("settled");

    const evs = await f.alerts.list({ type: "approval.consumed" });
    expect(evs.length).toBe(1);
    expect(evs[0].data.approvalId).toBe(id);
    expect(evs[0].data.spendId).toBe(entries[0].id);
  });

  it("одноразовость: второй retry того же tuple → 402 новый hold", async () => {
    const f = await mkApp({ approvalAboveUsd: 10 });
    const id = await parkThenApprove(f, 25, "job-1");
    expect((await f.pay(25, "job-1")).status).toBe(200);

    const second = await f.pay(25, "job-1");
    expect(second.status).toBe(402);
    const body = await second.json();
    expect(body.error).toBe("approval_required");
    // новый pending, а не reuse consumed permit
    expect(body.approvalId).not.toBe(id);
    expect(await f.approvals.countPending(W)).toBe(1);
  });

  it("consume-race: два параллельных retry → ровно один проходит", async () => {
    const f = await mkApp({ approvalAboveUsd: 10 });
    const id = await parkThenApprove(f, 25, "job-1");

    const [r1, r2] = await Promise.all([f.pay(25, "job-1"), f.pay(25, "job-1")]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 402]);

    const loser = [r1, r2].find((r) => r.status === 402)!;
    expect((await loser.json()).error).toBe("approval_required");

    const entries = await f.ledger.listByWallet(W);
    expect(entries.length).toBe(1);
    const a = await f.approvals.get(id);
    expect(a?.state).toBe("consumed");
    // loser запарковал новый pending
    expect(await f.approvals.countPending(W)).toBe(1);
  });

  it("expired permit → игнорируется → новый hold", async () => {
    const f = await mkApp({ approvalAboveUsd: 10 });
    // паркуем с уже прошедшим expiresAt — reads as expired
    const stale = await f.approvals.park({
      wallet: W,
      amountUsd: 25,
      kind: "eaas",
      refId: "job-1",
      expiresAt: Date.now() - 1,
    });
    await f.approvals.decide(stale.id, "approve", "owner"); // no-op on expired
    const res = await f.pay(25, "job-1");
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("approval_required");
    expect((await f.approvals.get(stale.id))?.state).not.toBe("consumed");
  });

  it("rejected permit → игнорируется → новый hold", async () => {
    const f = await mkApp({ approvalAboveUsd: 10 });
    const held = await f.pay(25, "job-1");
    const { approvalId } = await held.json();
    await f.approvals.decide(approvalId, "reject", "owner");

    const res = await f.pay(25, "job-1");
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("approval_required");
    expect(body.approvalId).not.toBe(approvalId);
  });

  it("mismatch refId → permit не совпадает → новый hold, permit цел", async () => {
    const f = await mkApp({ approvalAboveUsd: 10 });
    const id = await parkThenApprove(f, 25, "job-1");

    const res = await f.pay(25, "job-2");
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("approval_required");
    expect((await f.approvals.get(id))?.state).toBe("approved");
  });

  it("mismatch amount → permit не совпадает → новый hold", async () => {
    const f = await mkApp({ approvalAboveUsd: 10 });
    const id = await parkThenApprove(f, 25, "job-1");

    const res = await f.pay(30, "job-1");
    expect(res.status).toBe(402);
    expect((await f.approvals.get(id))?.state).toBe("approved");
  });

  it("consume до caps: пробитый кап на retry → spend_cap deny, permit consumed", async () => {
    const f = await mkApp({ approvalAboveUsd: 10, dailyUsd: 40 });
    const id = await parkThenApprove(f, 25, "job-1");
    // между approve и retry другой spend съедает daily
    await f.ledger.insert({
      id: "sp_ext",
      wallet: W,
      amountUsd: 20,
      kind: "eaas",
      refId: "other",
      state: "settled",
      at: Date.now(),
    });
    const res = await f.pay(25, "job-1");
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("spend_cap");
    // spec: lookup+consume до caps — one-shot сгорает даже на deny
    expect((await f.approvals.get(id))?.state).toBe("consumed");
  });
});
