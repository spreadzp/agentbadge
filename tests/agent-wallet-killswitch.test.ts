/**
 * SLICE-176-4 tests: kill-switch core — suspended flag + deny-path.
 *
 * Covered (per spec acceptance):
 *  - setSuspended round-trip: memory + json (flag, suspendedAt/By,
 *    unknown → false, resume очищает flag)
 *  - suspend глушит все 4 SpendKind мгновенно (402 spend_suspended,
 *    без reserve)
 *  - suspended — первая ветка: бьёт kind_not_allowed и caps
 *  - resume восстанавливает поведение полностью
 *  - suspendWallet: активные reserved → released, windowUsage
 *    не завышен (кап-пространство возвращается)
 *  - suspendWallet: unknown wallet → ok:false; повторный suspend
 *    идемпотентен (released:0)
 *  - wallet.suspended_deny alert + durable denied entry
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMemorySpendLedger,
  newSpendId,
  SPEND_KINDS,
  windowUsage,
  type SpendEntry,
} from "../src/server/lib/agent-wallet/ledger";
import {
  createSpendEnforcer,
  spendEnvelopeGate,
  initSpendEnforcer,
} from "../src/server/lib/agent-wallet/enforcer";
import { suspendWallet, releaseWalletReserves } from "../src/server/lib/agent-wallet/lifecycle";
import { reserve } from "../src/server/lib/agent-wallet/envelope";
import {
  createMemoryAgentWalletStore,
  createJsonAgentWalletStore,
  type AgentWalletRecord,
} from "../src/server/lib/agent-wallet/registry";
import {
  createMemorySpendAlertStore,
  initSpendAlerts,
} from "../src/server/lib/agent-wallet/audit";

const W = "0x00000000000000000000000000000000000000b4" as `0x${string}`;
const ACTOR = "0x00000000000000000000000000000000000000ff" as `0x${string}`;

const rec = (over: Partial<AgentWalletRecord> = {}): AgentWalletRecord => ({
  address: W,
  label: "x",
  kind: "eoa",
  envelope: {},
  registeredBy: W,
  createdAt: Date.now(),
  active: true,
  ...over,
});

const entry = (over: Partial<SpendEntry> = {}): SpendEntry => ({
  id: newSpendId(),
  wallet: W,
  amountUsd: 1,
  kind: "eaas",
  refId: "r",
  state: "reserved",
  at: Date.now(),
  ...over,
});

beforeEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});
afterEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});

describe("registry.setSuspended", () => {
  it("memory: flag + suspendedAt/By, resume очищает flag, unknown → false", async () => {
    const s = createMemoryAgentWalletStore();
    await s.put(rec());
    expect(await s.setSuspended(W, true, ACTOR)).toBe(true);
    const susp = await s.get(W);
    expect(susp?.suspended).toBe(true);
    expect(susp?.suspendedAt).toBeGreaterThan(0);
    expect(susp?.suspendedBy).toBe(ACTOR);
    expect(await s.setSuspended("0x00000000000000000000000000000000000000ee", true)).toBe(false);
    expect(await s.setSuspended(W, false)).toBe(true);
    const resum = await s.get(W);
    expect(resum?.suspended).toBe(false);
    expect(resum?.active).toBe(true); // quarantine ≠ deactivate
  });

  it("json: round-trip suspended через рестарт (новый store instance)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-ks-"));
    const s = createJsonAgentWalletStore(join(dir, "wallets.json"));
    await s.put(rec());
    await s.setSuspended(W, true, ACTOR);
    const s2 = createJsonAgentWalletStore(join(dir, "wallets.json"));
    expect((await s2.get(W))?.suspended).toBe(true);
    expect((await s2.get(W))?.suspendedBy).toBe(ACTOR);
    await s2.setSuspended(W, false);
    const s3 = createJsonAgentWalletStore(join(dir, "wallets.json"));
    expect((await s3.get(W))?.suspended).toBe(false);
  });
});

describe("enforcer suspended deny path", () => {
  function mkApp(kind: "eaas" | "x402" | "subscription" | "venue-fee") {
    const store = createMemoryAgentWalletStore();
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
    app.use("/api/pay", spendEnvelopeGate({ kind, amountUsdFor: () => 1 }));
    app.post("/api/pay", (c) => c.json({ paid: true }));
    const post = () =>
      app.request("/api/pay", { method: "POST", headers: { "x-wallet": W } });
    return { store, ledger, alertStore, post };
  }

  it("suspend глушит все 4 SpendKind мгновенно — 402 spend_suspended, без reserve", async () => {
    for (const kind of SPEND_KINDS) {
      const { store, ledger, post } = mkApp(kind);
      await store.put(rec({ suspended: true, envelope: { perTxUsd: 10 } }));
      const res = await post();
      expect(res.status).toBe(402);
      expect((await res.json()).error).toBe("spend_suspended");
      const entries = await ledger.listByWallet(W);
      expect(entries.length).toBe(1);
      expect(entries[0].state).toBe("denied");
      expect(entries[0].denialReason).toBe("spend_suspended");
    }
  });

  it("suspended — первая ветка: бьёт kind_not_allowed и velocity", async () => {
    const { store, post } = mkApp("x402");
    await store.put(
      rec({
        suspended: true,
        envelope: { allowedKinds: ["eaas"], maxTxPerHour: 1 },
      }),
    );
    const res = await post();
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("spend_suspended");
  });

  it("wallet.suspended_deny alert", async () => {
    const { store, alertStore, post } = mkApp("eaas");
    await store.put(rec({ suspended: true }));
    await post();
    const alerts = await alertStore.list({ type: "wallet.suspended_deny" });
    expect(alerts.length).toBe(1);
    expect(alerts[0].data.kind).toBe("eaas");
  });

  it("resume восстанавливает поведение полностью", async () => {
    const { store, ledger, post } = mkApp("eaas");
    await store.put(rec({ envelope: { perTxUsd: 10 } }));
    await store.setSuspended(W, true, ACTOR);
    expect((await post()).status).toBe(402);
    await store.setSuspended(W, false);
    const res = await post();
    expect(res.status).toBe(200);
    const entries = await ledger.listByWallet(W);
    expect(entries.filter((e) => e.state === "settled").length).toBe(1);
  });
});

describe("suspendWallet orchestration", () => {
  it("reserved → released: windowUsage не завышен, кап-пространство возвращается", async () => {
    const store = createMemoryAgentWalletStore();
    const ledger = createMemorySpendLedger();
    await store.put(rec({ envelope: { perTxUsd: 10, dailyUsd: 5 } }));
    // резервируем 5 из dailyUsd:5 — вторая резервация того же дня deny
    const r1 = await reserve(ledger, { perTxUsd: 10, dailyUsd: 5 }, W, 5, "eaas", "r1");
    expect(r1.ok).toBe(true);
    const r2 = await reserve(ledger, { perTxUsd: 10, dailyUsd: 5 }, W, 5, "eaas", "r2");
    expect(r2.ok).toBe(false); // daily исчерпан

    const res = await suspendWallet({ store, ledger }, W, true, ACTOR);
    expect(res.ok).toBe(true);
    expect(res.suspended).toBe(true);
    expect(res.released).toBe(1);

    // резерв отпущен — окно пустое
    expect((await windowUsage(ledger, W, 86_400)).used).toBe(0);
    const entries = await ledger.listByWallet(W);
    expect(entries.find((e) => e.refId === "r1")?.state).toBe("released");

    // после suspend новая резервация deny (kill-switch), не caps
    const r3 = await reserve(ledger, { perTxUsd: 10, dailyUsd: 5 }, W, 1, "eaas", "r3");
    expect(r3.ok).toBe(true); // reserve() сам не знает про suspend —
    // enforcer.begin проверяет; см. deny-path тесты выше.
  });

  it("unknown wallet → ok:false; повторный suspend идемпотентен (released:0)", async () => {
    const store = createMemoryAgentWalletStore();
    const ledger = createMemorySpendLedger();
    const unknown = await suspendWallet(
      { store, ledger },
      "0x00000000000000000000000000000000000000ee",
      true,
    );
    expect(unknown.ok).toBe(false);

    await store.put(rec());
    const first = await suspendWallet({ store, ledger }, W, true, ACTOR);
    expect(first.released).toBe(0);
    const second = await suspendWallet({ store, ledger }, W, true, ACTOR);
    expect(second.ok).toBe(true);
    expect(second.released).toBe(0);
  });

  it("resume не трогает ledger (released:0)", async () => {
    const store = createMemoryAgentWalletStore();
    const ledger = createMemorySpendLedger();
    await store.put(rec());
    await suspendWallet({ store, ledger }, W, true, ACTOR);
    const res = await suspendWallet({ store, ledger }, W, false);
    expect(res.suspended).toBe(false);
    expect(res.released).toBe(0);
    expect((await store.get(W))?.suspended).toBe(false);
  });

  it("releaseWalletReserves трогает только reserved", async () => {
    const ledger = createMemorySpendLedger();
    await ledger.insert(entry({ refId: "r1" }));
    await ledger.insert(entry({ refId: "s1", state: "settled" }));
    await ledger.insert(entry({ refId: "d1", state: "denied" }));
    const n = await releaseWalletReserves(ledger, W);
    expect(n).toBe(1);
    const entries = await ledger.listByWallet(W);
    expect(entries.find((e) => e.refId === "r1")?.state).toBe("released");
    expect(entries.find((e) => e.refId === "s1")?.state).toBe("settled");
    expect(entries.find((e) => e.refId === "d1")?.state).toBe("denied");
  });
});
