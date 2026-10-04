/**
 * SLICE-176-2 tests: velocity enforcement — hourly tx-count + USD caps.
 *
 * Covered (per spec acceptance):
 *  - runaway: 10 мелких платежей → 11-й deny velocity_tx (cap 10)
 *  - hourly amount cap срабатывает при perTx << cap → velocity_amount
 *  - released/failed освобождают count И amount
 *  - граница окна: entry ровно на now−3600 НЕ считается
 *  - капы независимы (только count / только amount)
 *  - без новых caps поведение идентично 155-2
 *  - enforcer: velocity deny → 402 + deny-JSON код + spend.velocity_denied
 *    alert + durable denied ledger entry
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import {
  createMemorySpendLedger,
  newSpendId,
  windowCount,
  WINDOW_SEC,
  type SpendEntry,
} from "../src/server/lib/agent-wallet/ledger";
import {
  checkEnvelope,
  reserve,
} from "../src/server/lib/agent-wallet/envelope";
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
} from "../src/server/lib/agent-wallet/audit";

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const NOW = 1_800_000_000_000;

const entry = (over: Partial<SpendEntry> = {}): SpendEntry => ({
  id: newSpendId(),
  wallet: W,
  amountUsd: 1,
  kind: "eaas",
  refId: "r",
  state: "settled",
  at: NOW,
  ...over,
});

const rec = (envelope = {}): AgentWalletRecord => ({
  address: W,
  label: "x",
  kind: "eoa",
  envelope,
  registeredBy: W,
  createdAt: Date.now(),
  active: true,
});

beforeEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});
afterEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});

describe("WINDOW_SEC + windowCount", () => {
  it("hourly = 3600", () => {
    expect(WINDOW_SEC.hourly).toBe(3600);
  });

  it("counts reserved+settled in window; skips released/failed/denied", async () => {
    const ledger = createMemorySpendLedger();
    await ledger.insert(entry({ state: "reserved" }));
    await ledger.insert(entry({ state: "settled" }));
    await ledger.insert(entry({ state: "released" }));
    await ledger.insert(entry({ state: "failed" }));
    await ledger.insert(entry({ state: "denied" }));
    const r = await windowCount(ledger, W, 3600, NOW + 1000);
    expect(r.count).toBe(2);
  });

  it("boundary: entry at exactly now−window is NOT counted", async () => {
    const ledger = createMemorySpendLedger();
    // exactly on the boundary — outside
    await ledger.insert(entry({ at: NOW - 3_600_000 }));
    // one ms inside — counts
    await ledger.insert(entry({ at: NOW - 3_600_000 + 1 }));
    const r = await windowCount(ledger, W, 3600, NOW);
    expect(r.count).toBe(1);
    expect(r.used).toBe(1);
  });
});

describe("checkEnvelope — velocity caps", () => {
  it("runaway: 10 мелких платежей → 11-й deny velocity_tx", async () => {
    const ledger = createMemorySpendLedger();
    const caps = { maxTxPerHour: 10 };
    for (let i = 0; i < 10; i++) {
      const v = await checkEnvelope(ledger, caps, W, 1, NOW);
      expect(v.allow).toBe(true);
      await ledger.insert(entry({ state: "reserved" }));
    }
    const v = await checkEnvelope(ledger, caps, W, 1, NOW);
    expect(v.allow).toBe(false);
    if (!v.allow) {
      expect(v.deny.cap).toBe("velocity_tx");
      expect(v.deny.used).toBe(10);
      expect(v.deny.limit).toBe(10);
      // resetAt — когда старейшая запись уйдёт за окно
      expect(v.deny.resetAt).toBe(Math.floor((NOW + 3_600_000) / 1000));
    }
  });

  it("hourly amount cap срабатывает при perTx << cap → velocity_amount", async () => {
    const ledger = createMemorySpendLedger();
    const caps = { perTxUsd: 20, maxAmountPerHour: 100 };
    for (let i = 0; i < 9; i++) {
      await ledger.insert(entry({ amountUsd: 10 })); // 90 used
    }
    const v = await checkEnvelope(ledger, caps, W, 15, NOW); // 105 > 100
    expect(v.allow).toBe(false);
    if (!v.allow) {
      expect(v.deny.cap).toBe("velocity_amount");
      expect(v.deny.used).toBe(90);
      expect(v.deny.limit).toBe(100);
      expect(v.deny.resetAt).toBeGreaterThan(0);
    }
    // perTx проверяется первым: 25 > 20 → perTx deny
    const v2 = await checkEnvelope(ledger, caps, W, 25, NOW);
    expect(v2.allow).toBe(false);
    if (!v2.allow) expect(v2.deny.cap).toBe("perTx");
  });

  it("released/failed освобождают count И amount", async () => {
    const ledger = createMemorySpendLedger();
    const caps = { maxTxPerHour: 2, maxAmountPerHour: 20 };
    // reserved — переходимые состояния (settled терминален)
    const e1 = entry({ amountUsd: 10, state: "reserved" });
    const e2 = entry({ amountUsd: 10, state: "reserved" });
    await ledger.insert(e1);
    await ledger.insert(e2);
    let v = await checkEnvelope(ledger, caps, W, 1, NOW);
    expect(v.allow).toBe(false);
    // release one → count 1 < 2 AND used 10 + 1 ≤ 20 → allow
    await ledger.transition(e1.id, "released");
    v = await checkEnvelope(ledger, caps, W, 1, NOW);
    expect(v.allow).toBe(true);
    // fail the other → 0 used → allow even for big amounts under perTx
    await ledger.transition(e2.id, "failed");
    v = await checkEnvelope(ledger, caps, W, 19, NOW);
    expect(v.allow).toBe(true);
  });

  it("entry ровно на now−3600 не считается ни в count, ни в amount", async () => {
    const ledger = createMemorySpendLedger();
    await ledger.insert(entry({ at: NOW - 3_600_000, amountUsd: 50 }));
    const v = await checkEnvelope(
      ledger,
      { maxTxPerHour: 1, maxAmountPerHour: 10 },
      W,
      5,
      NOW,
    );
    expect(v.allow).toBe(true);
  });

  it("капы независимы: только count / только amount", async () => {
    const ledger = createMemorySpendLedger();
    await ledger.insert(entry({ amountUsd: 999 }));
    // только count: большая сумма в часе — ок, 2-я tx — deny
    let v = await checkEnvelope(ledger, { maxTxPerHour: 1 }, W, 5000, NOW);
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.deny.cap).toBe("velocity_tx");
    // только amount: много tx — ок, пока сумма под капом
    const l2 = createMemorySpendLedger();
    for (let i = 0; i < 50; i++) await l2.insert(entry({ amountUsd: 1 }));
    v = await checkEnvelope(l2, { maxAmountPerHour: 100 }, W, 1, NOW);
    expect(v.allow).toBe(true);
  });

  it("без новых caps — поведение как в 155-2 (daily deny)", async () => {
    const ledger = createMemorySpendLedger();
    await ledger.insert(entry({ amountUsd: 40 }));
    const v = await checkEnvelope(ledger, { dailyUsd: 50 }, W, 15, NOW);
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.deny.cap).toBe("daily");
  });

  it("reserve(): velocity deny не создаёт entry", async () => {
    const ledger = createMemorySpendLedger();
    await ledger.insert(entry());
    const r = await reserve(ledger, { maxTxPerHour: 1 }, W, 1, "eaas", "x");
    expect(r.ok).toBe(false);
    expect((await ledger.listByWallet(W)).length).toBe(1);
  });
});

describe("enforcer velocity deny path", () => {
  it("402 velocity_tx + spend.velocity_denied alert + durable denied entry", async () => {
    const store = createMemoryAgentWalletStore();
    await store.put(rec({ maxTxPerHour: 1 }));
    const ledger = createMemorySpendLedger();
    const alertStore = createMemorySpendAlertStore();
    initSpendAlerts({ store: alertStore });
    const enforcer = createSpendEnforcer({
      ledger,
      registry: store,
      requireRegistered: false,
    });
    initSpendEnforcer(enforcer);
    const app = new Hono();
    app.use("/api/pay", spendEnvelopeGate({ kind: "eaas", amountUsdFor: () => 1 }));
    app.post("/api/pay", (c) => c.json({ paid: true }));

    const first = await app.request("/api/pay", {
      method: "POST",
      headers: { "x-wallet": W },
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/pay", {
      method: "POST",
      headers: { "x-wallet": W },
    });
    expect(second.status).toBe(402);
    const body = await second.json();
    expect(body.error).toBe("velocity_tx");
    expect(body.cap).toBe("velocity_tx");
    expect(body.limit).toBe(1);
    expect(body.resetAt).toBeGreaterThan(0);

    // alert type — velocity_denied, не cap_denied
    const alerts = await alertStore.list({ type: "spend.velocity_denied" });
    expect(alerts.length).toBe(1);
    expect(alerts[0].data.cap).toBe("velocity_tx");
    expect(alerts[0].data.windowSec).toBe(3600);
    expect(await alertStore.list({ type: "spend.cap_denied" })).toEqual([]);

    // durable denied entry
    const denied = (await ledger.listByWallet(W)).find(
      (e) => e.state === "denied",
    );
    expect(denied?.denialReason).toBe("velocity_tx");
  });
});
