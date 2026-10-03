/**
 * SLICE-156-3: CrosschainPayment state machine + SettlePoller tests.
 *
 * Semantics: business access on authorized/settling; money metrics on
 * settled. Poller walks pending entries to terminal via statusLookup —
 * expiry past expiresAt + grace wins over a live transfer status.
 */

import { describe, it, expect, vi } from "vitest";
import type { PaymentInfo, PaymentStatus } from "@agentbadge/circle-payments";
import {
  createCrosschainPaymentsStore,
  createSettlePoller,
  crosschainStats,
  recordPayment,
  settleTerminalOutcome,
  type CrosschainPayment,
} from "../src/server/lib/crosschain-payments";

const PAYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const TX = "0x" + "ab".repeat(32);

const pmt = (over: Partial<PaymentInfo> = {}): PaymentInfo =>
  ({
    payer: PAYER,
    network: "eip155:84532",
    scheme: "gateway-batch",
    amount: "5000000",
    ...over,
  }) as PaymentInfo;

const status = (
  s: PaymentStatus["status"],
  ref: string = UUID,
): PaymentStatus => ({ status: s, ref, refType: "gateway-transfer" });

describe("recordPayment", () => {
  it("gateway-batch + UUID transaction → settling with transferId + expiry", () => {
    const store = createCrosschainPaymentsStore();
    const e = recordPayment(store, pmt({ transaction: UUID }),
      "/api/venue/v1/subscribe", PAYTO, 60_000);
    expect(e.state).toBe("settling");
    expect(e.transferId).toBe(UUID);
    expect(e.id).toBe(UUID);
    expect(e.expiresAt).toBeGreaterThan(Date.now() + 50_000);
    expect(e.sourceChain).toBe("eip155:84532");
    expect(e.scheme).toBe("gateway-batch");
    expect(e.amountUsd).toBe("5.00");
    expect(e.ref.kind).toBe("subscription");
    expect(store.get(UUID)).toBeDefined();
  });

  it("tx-hash transaction → settled immediately with settleTx", () => {
    const store = createCrosschainPaymentsStore();
    const e = recordPayment(store, pmt({ transaction: TX }),
      "/api/scan-packs/buy", PAYTO, 60_000);
    expect(e.state).toBe("settled");
    expect(e.settleTx).toBe(TX);
    expect(e.settledAt).toBeGreaterThan(0);
    expect(e.transferId).toBeUndefined();
    expect(e.expiresAt).toBeUndefined();
    expect(e.ref.kind).toBe("pack");
  });

  it("exact scheme + UUID → authorized (UUID alone is not settling)", () => {
    const store = createCrosschainPaymentsStore();
    const e = recordPayment(store, pmt({ scheme: "exact", transaction: UUID }),
      "/api/x", PAYTO, 60_000);
    expect(e.state).toBe("authorized");
    expect(e.transferId).toBe(UUID); // still tracked — poller can advance it
  });

  it("no transaction → authorized with synthetic id + payer fallback", () => {
    const store = createCrosschainPaymentsStore();
    const e = recordPayment(store, pmt({ payer: undefined }),
      "/api/eaas/run", PAYTO, 60_000);
    expect(e.state).toBe("authorized");
    expect(e.id).toMatch(/^pmt_/);
    expect(e.payer).toBe("0x0");
    expect(e.ref.kind).toBe("eaas");
  });
});

describe("crosschain payments store", () => {
  const mk = (id: string, state: CrosschainPayment["state"]) => ({
    id, payer: PAYER, sourceChain: "eip155:1", scheme: "exact",
    amountUsd: "1.00", payTo: PAYTO,
    ref: { kind: "x402" as const, id: "/x" },
    state, authorizedAt: Date.now(),
  });

  it("put/get/update/pending/list + terminal filtering", () => {
    const store = createCrosschainPaymentsStore();
    store.put(mk("a", "settling"));
    store.put(mk("b", "settled"));
    store.put(mk("c", "expired"));
    expect(store.pending().map((e) => e.id)).toEqual(["a"]);
    expect(store.list()).toHaveLength(3);
    expect(store.update("a", { state: "failed" })).toBe(true);
    expect(store.get("a")?.state).toBe("failed");
    expect(store.update("zzz", { state: "failed" })).toBe(false);
  });
});

describe("settle poller", () => {
  const seeded = (over: Partial<CrosschainPayment> = {}) => ({
    id: UUID, payer: PAYER, sourceChain: "eip155:84532",
    scheme: "gateway-batch", amountUsd: "5.00", payTo: PAYTO,
    ref: { kind: "subscription" as const, id: "/api/venue/v1/subscribe" },
    state: "settling" as const, transferId: UUID,
    authorizedAt: Date.now(), expiresAt: Date.now() + 60_000,
    ...over,
  });

  it("completed transfer → settled + settleTx attached + onTerminal", async () => {
    const store = createCrosschainPaymentsStore();
    store.put(seeded());
    const onTerminal = vi.fn();
    const poller = createSettlePoller({
      store,
      statusLookup: async () => status("completed", TX),
      pollMs: 60_000,
      onTerminal,
    });
    expect(await poller.tick()).toBe(1);
    const e = store.get(UUID)!;
    expect(e.state).toBe("settled");
    expect(e.settleTx).toBe(TX);
    expect(e.settledAt).toBeGreaterThan(0);
    expect(onTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: UUID, state: "settled" }),
    );
  });

  it("failed transfer → failed + onTerminal", async () => {
    const store = createCrosschainPaymentsStore();
    store.put(seeded());
    const onTerminal = vi.fn();
    const poller = createSettlePoller({
      store,
      statusLookup: async () => status("failed"),
      pollMs: 60_000,
      onTerminal,
    });
    expect(await poller.tick()).toBe(1);
    expect(store.get(UUID)?.state).toBe("failed");
    expect(onTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failed" }),
    );
  });

  it("pending transfer advances authorized → settling (non-terminal)", async () => {
    const store = createCrosschainPaymentsStore();
    store.put(seeded({ state: "authorized" }));
    const onTerminal = vi.fn();
    const poller = createSettlePoller({
      store,
      statusLookup: async () => status("pending"),
      pollMs: 60_000,
      onTerminal,
    });
    expect(await poller.tick()).toBe(0);
    expect(store.get(UUID)?.state).toBe("settling");
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it("expired past expiresAt → expired, lookup never called", async () => {
    const store = createCrosschainPaymentsStore();
    store.put(seeded({ expiresAt: Date.now() - 1 }));
    const lookup = vi.fn(async () => status("completed"));
    const onTerminal = vi.fn();
    const poller = createSettlePoller({
      store, statusLookup: lookup, pollMs: 60_000, onTerminal,
    });
    expect(await poller.tick()).toBe(1);
    expect(store.get(UUID)?.state).toBe("expired");
    expect(lookup).not.toHaveBeenCalled();
    expect(onTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ state: "expired" }),
    );
  });

  it("lookup throw → entry stays pending; terminal entries untouched", async () => {
    const store = createCrosschainPaymentsStore();
    store.put(seeded());
    store.put(seeded({ id: "done", state: "settled" }));
    const lookup = vi.fn(async () => {
      throw new Error("gateway down");
    });
    const poller = createSettlePoller({
      store, statusLookup: lookup, pollMs: 60_000,
    });
    expect(await poller.tick()).toBe(0);
    expect(store.get(UUID)?.state).toBe("settling");
    expect(lookup).toHaveBeenCalledTimes(1); // settled entry skipped
  });
});

describe("SLICE-156-5: expiry/refund + failure handling", () => {
  const entry = (over: Partial<CrosschainPayment> = {}) => ({
    id: UUID, payer: PAYER, sourceChain: "eip155:84532",
    scheme: "gateway-batch", amountUsd: "5.00", payTo: PAYTO,
    ref: { kind: "subscription" as const, id: "/api/venue/v1/subscribe" },
    state: "settling" as const, transferId: UUID,
    authorizedAt: Date.now(), expiresAt: Date.now() + 60_000,
    ...over,
  });

  it("recordPayment is idempotent — same ref never duplicates or regresses", () => {
    const store = createCrosschainPaymentsStore();
    const p = pmt({ transaction: UUID });
    recordPayment(store, p, "/x", PAYTO, 60_000);
    store.update(UUID, { state: "settled", settleTx: TX });
    const again = recordPayment(store, p, "/x", PAYTO, 60_000);
    expect(store.list()).toHaveLength(1);
    expect(again.state).toBe("settled");
    expect(store.get(UUID)?.settleTx).toBe(TX);
  });

  it("settled → payment.settled, no churned mark", () => {
    const store = createCrosschainPaymentsStore();
    store.put(entry({ state: "settled" }));
    expect(settleTerminalOutcome(store, store.get(UUID)!)).toBe(
      "payment.settled",
    );
    expect(store.get(UUID)?.churned).toBeUndefined();
  });

  it("expired/failed → event name + churned mark (MVP mark+alert)", () => {
    const store = createCrosschainPaymentsStore();
    store.put(entry({ state: "expired" }));
    store.put(entry({ id: "f1", state: "failed", transferId: undefined }));
    expect(settleTerminalOutcome(store, store.get(UUID)!)).toBe(
      "payment.expired",
    );
    expect(settleTerminalOutcome(store, store.get("f1")!)).toBe(
      "payment.failed",
    );
    expect(store.get(UUID)?.churned).toBe(true);
    expect(store.get("f1")?.churned).toBe(true);
    // already churned → idempotent, still returns event name
    expect(settleTerminalOutcome(store, store.get(UUID)!)).toBe(
      "payment.expired",
    );
  });

  it("non-terminal → null (no mark, no event)", () => {
    const store = createCrosschainPaymentsStore();
    store.put(entry({ state: "authorized" }));
    expect(settleTerminalOutcome(store, store.get(UUID)!)).toBeNull();
    expect(store.get(UUID)?.churned).toBeUndefined();
  });

  it("crosschainStats — counts + expiryRate over terminal entries", () => {
    const store = createCrosschainPaymentsStore();
    store.put(entry({ id: "s1", state: "settled" }));
    store.put(entry({ id: "s2", state: "settled" }));
    store.put(entry({ id: "e1", state: "expired" }));
    store.put(entry({ id: "p1" })); // settling — non-terminal
    const st = crosschainStats(store);
    expect(st).toMatchObject({
      total: 4, settled: 2, expired: 1, failed: 0, pending: 1,
      expiryRate: 1 / 3,
    });
  });

  it("no eternal pending — all expired entries leave pending()", async () => {
    const store = createCrosschainPaymentsStore();
    store.put(entry({ expiresAt: Date.now() - 1 }));
    store.put(entry({ id: "e2", expiresAt: Date.now() - 2 }));
    const poller = createSettlePoller({
      store, statusLookup: async () => status("pending"), pollMs: 60_000,
    });
    expect(await poller.tick()).toBe(2);
    expect(store.pending()).toHaveLength(0);
  });
});
