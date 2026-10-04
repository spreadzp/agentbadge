/**
 * SLICE-176-3 tests: allowedKinds enforcement — kind-check до reserve.
 *
 * Covered (per spec acceptance):
 *  - каждый SpendKind вне allowedKinds → 402 kind_not_allowed
 *  - kind в списке проходит, reserve создаётся
 *  - allowedKinds unset = allow-all
 *  - denied-kind не тратит денежные капы (нет reserve, denied-entries
 *    не считаются в окнах)
 *  - порядок веток: kind-check до caps (kind_not_allowed бьёт velocity)
 *  - spend.kind_denied alert + durable denied ledger entry
 *  - defaultCaps.allowedKinds применяется при пустом envelope записи
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import {
  createMemorySpendLedger,
  SPEND_KINDS,
  type SpendKind,
} from "../src/server/lib/agent-wallet/ledger";
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
} from "../src/server/lib/agent-wallet/audit";

const W = "0x00000000000000000000000000000000000000b3" as `0x${string}`;

const rec = (envelope: SpendCaps = {}): AgentWalletRecord => ({
  address: W,
  label: "x",
  kind: "eoa",
  envelope,
  registeredBy: W,
  createdAt: Date.now(),
  active: true,
});

/** App + deps с одним gated-роутом фиксированного kind. */
function mkApp(kind: SpendKind, deps: Partial<SpendEnforcerDeps> = {}) {
  const store = createMemoryAgentWalletStore();
  const ledger = createMemorySpendLedger();
  const alertStore = createMemorySpendAlertStore();
  initSpendAlerts({ store: alertStore });
  const enforcer = createSpendEnforcer({
    ledger,
    registry: store,
    requireRegistered: false,
    ...deps,
  });
  initSpendEnforcer(enforcer);
  const app = new Hono();
  app.use("/api/pay", spendEnvelopeGate({ kind, amountUsdFor: () => 1 }));
  app.post("/api/pay", (c) => c.json({ paid: true }));
  const post = () =>
    app.request("/api/pay", { method: "POST", headers: { "x-wallet": W } });
  return { store, ledger, alertStore, post };
}

/** App с двумя роутами разных kind'ов на общих deps (для caps-инвариантов). */
function mkMultiApp() {
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
  for (const kind of ["eaas", "x402"] as const) {
    app.use(`/api/${kind}`, spendEnvelopeGate({ kind, amountUsdFor: () => 1 }));
    app.post(`/api/${kind}`, (c) => c.json({ paid: true }));
  }
  const post = (kind: "eaas" | "x402") =>
    app.request(`/api/${kind}`, {
      method: "POST",
      headers: { "x-wallet": W },
    });
  return { store, ledger, alertStore, post };
}

beforeEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});
afterEach(() => {
  initSpendEnforcer(null);
  initSpendAlerts(null);
});

describe("enforcer allowedKinds", () => {
  it("каждый SpendKind вне списка → 402 kind_not_allowed {kind, allowedKinds}", async () => {
    for (const kind of SPEND_KINDS) {
      if (kind === "eaas") continue;
      const { store, ledger, post } = mkApp(kind);
      await store.put(rec({ allowedKinds: ["eaas"], perTxUsd: 10 }));

      const res = await post();
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.error).toBe("kind_not_allowed");
      expect(body.kind).toBe(kind);
      expect(body.allowedKinds).toEqual(["eaas"]);

      // durable denied entry, reserve НЕ создан
      const entries = await ledger.listByWallet(W);
      expect(entries.length).toBe(1);
      expect(entries[0].state).toBe("denied");
      expect(entries[0].denialReason).toBe("kind_not_allowed");
    }
  });

  it("kind в списке → 200, entry доезжает до settled", async () => {
    const { store, ledger, post } = mkApp("x402");
    await store.put(rec({ allowedKinds: ["eaas", "x402"], perTxUsd: 10 }));
    const res = await post();
    expect(res.status).toBe(200);
    const entries = await ledger.listByWallet(W);
    expect(entries.length).toBe(1);
    expect(entries[0].state).toBe("settled");
  });

  it("allowedKinds unset → allow-all для всех kind'ов", async () => {
    for (const kind of SPEND_KINDS) {
      const { store, post } = mkApp(kind);
      await store.put(rec({ perTxUsd: 10 }));
      const res = await post();
      expect(res.status).toBe(200);
    }
  });

  it("denied-kind не тратит капы: разрешённый kind всё ещё проходит", async () => {
    const { store, ledger, post } = mkMultiApp();
    // maxTxPerHour=1 — если бы denied-entry ел слот, eaas был бы denied.
    await store.put(rec({ allowedKinds: ["eaas"], maxTxPerHour: 1 }));

    const denied = await post("x402");
    expect(denied.status).toBe(402);

    const ok = await post("eaas");
    expect(ok.status).toBe(200);

    const entries = await ledger.listByWallet(W);
    expect(entries.filter((e) => e.state === "denied").length).toBe(1);
    expect(entries.filter((e) => e.state === "settled").length).toBe(1);
    expect(entries.filter((e) => e.state === "reserved").length).toBe(0);
  });

  it("kind-check до caps: kind_not_allowed бьёт velocity_tx", async () => {
    const { store, post } = mkMultiApp();
    await store.put(rec({ allowedKinds: ["eaas"], maxTxPerHour: 1 }));
    // съедаем единственный hourly слот разрешённым kind'ом
    expect((await post("eaas")).status).toBe(200);
    // x402 — denied; код должен быть kind_not_allowed, не velocity_tx
    const res = await post("x402");
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("kind_not_allowed");
  });

  it("spend.kind_denied alert с kind и allowedKinds в data", async () => {
    const { store, alertStore, post } = mkApp("subscription");
    await store.put(rec({ allowedKinds: ["eaas"] }));
    await post();
    const alerts = await alertStore.list({ type: "spend.kind_denied" });
    expect(alerts.length).toBe(1);
    expect(alerts[0].data.kind).toBe("subscription");
    expect(alerts[0].data.allowedKinds).toEqual(["eaas"]);
    expect(await alertStore.list({ type: "spend.cap_denied" })).toEqual([]);
  });

  it("defaultCaps.allowedKinds применяется при пустом envelope записи", async () => {
    const { store, post } = mkApp("x402", {
      defaultCaps: { allowedKinds: ["eaas"] },
    });
    await store.put(rec({}));
    const res = await post();
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("kind_not_allowed");
  });
});
