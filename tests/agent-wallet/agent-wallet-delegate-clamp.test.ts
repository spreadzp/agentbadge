/**
 * SLICE-263-2 tests: MMF v0.5-clamp on the delegate path —
 * DelegateRecord.clamp + clamped spendAsDelegate verdict.
 *
 * Covered (per slice AC):
 *  - rec.clamp absent/false + over-cap → cap-exceeded (D4 identical)
 *  - clamp:true + amount > effectiveCap → ok:true, kit.spend gets
 *    STRICTLY effective, result carries all 4 clamp fields
 *  - owner tightening: effectiveCap = min(stored, live perTx) — clamp
 *    binds to the NEW cap (D5 live resolution unchanged)
 *  - non-positive/non-finite amount + clamp → deny BEFORE cap-check
 *    (draft NON_POSITIVE-first), kit untouched
 *  - suspended owner + clamp → delegate-suspended (D1 order intact)
 *  - POST /delegate clamp non-bool → 400; clamp:true → record.clamp;
 *    re-register REPLACES the whole record incl. clamp (D-263-Q2)
 *  - GET /delegate exposes record.clamp (transparency)
 */
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { buildAccessChallenge } from "../../src/server/middleware/agent-auth";

import {
  createMemoryDelegateStore,
  spendAsDelegate,
  validateDelegateInput,
  type DelegateRecord,
  type DelegateSpendKit,
} from "../../src/server/lib/agent-wallet/delegate";
import { createMemoryAgentWalletStore } from "../../src/server/lib/agent-wallet/registry";
import { createAgentWalletDelegateRoutes } from "../../src/server/routes/agent-wallet/agent-wallet-delegate-api";

// Hardhat accounts — well-known test keys, never hold real funds.
const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const W = owner.address as `0x${string}`;
const DELEGATE = "0x2222222222222222222222222222222222222222" as const;
const CHAIN = "Base_Sepolia";

const rec = (over: Partial<DelegateRecord> = {}): DelegateRecord => ({
  ownerWallet: W,
  delegate: DELEGATE,
  chain: CHAIN,
  spendCapUsd: 10,
  authorizedAt: Date.now(),
  ...over,
});

const readyKit = (): DelegateSpendKit => ({
  getDelegateStatus: vi.fn(async () => "ready" as const),
  spend: vi.fn(async () => ({ transferId: "tr-1" })),
});

async function ownerStore(perTxUsd?: number) {
  const ws = createMemoryAgentWalletStore();
  await ws.put({
    address: W,
    label: "owner",
    kind: "eoa",
    envelope: perTxUsd !== undefined ? { perTxUsd } : {},
    registeredBy: W,
    createdAt: Date.now(),
    active: true,
  });
  return ws;
}

const spendArgs = (amountUsd: string, ws: Awaited<ReturnType<typeof ownerStore>>) => ({
  ownerWallet: W,
  chain: CHAIN,
  amountUsd,
  to: { chain: "Arc_Testnet", recipientAddress: W },
  walletStore: ws,
});

async function signed(method: string, path: string, body = "") {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const signature = await owner.signMessage({
    message: buildAccessChallenge({
      wallet: owner.address,
      method,
      path,
      timestamp,
      nonce,
      bodyHash: body ? createHash("sha256").update(body).digest("hex") : "-",
    }),
  });
  return {
    "x-wallet": owner.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
    "x-nonce": nonce,
  };
}

/* ------------------------------ validation ------------------------------- */

describe("validateDelegateInput — clamp flag (D-263-Q2)", () => {
  const base = { ownerWallet: W, delegate: DELEGATE, chain: CHAIN, spendCapUsd: 10 };

  it("boolean stored; absent → off; non-boolean → throw", () => {
    expect(validateDelegateInput({ ...base, clamp: true }).clamp).toBe(true);
    expect(validateDelegateInput({ ...base, clamp: false }).clamp).toBe(false);
    expect(validateDelegateInput(base).clamp).toBeUndefined();
    expect(() => validateDelegateInput({ ...base, clamp: "yes" as never })).toThrow(
      /boolean/,
    );
    expect(() => validateDelegateInput({ ...base, clamp: 1 as never })).toThrow(
      /boolean/,
    );
  });
});

/* ---------------------------- spendAsDelegate ---------------------------- */

describe("spendAsDelegate — clamp resolution", () => {
  it("AC1: rec.clamp absent → over-cap deny identical (D4)", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec()); // no clamp
    const kit = readyKit();
    const res = await spendAsDelegate(
      store,
      kit,
      spendArgs("25", await ownerStore()),
    );
    expect(res).toEqual({ ok: false, reason: "cap-exceeded" });
    expect(kit.spend).not.toHaveBeenCalled();
    expect(kit.getDelegateStatus).not.toHaveBeenCalled(); // deny before status
  });

  it("AC1: rec.clamp:false → identical deny", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec({ clamp: false }));
    const res = await spendAsDelegate(
      store,
      readyKit(),
      spendArgs("25", await ownerStore()),
    );
    expect(res).toEqual({ ok: false, reason: "cap-exceeded" });
  });

  it("AC2: clamp:true + over-cap → ok:true, kit.spend gets STRICTLY effective", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec({ spendCapUsd: 10, clamp: true }));
    const kit = readyKit();
    const res = await spendAsDelegate(
      store,
      kit,
      spendArgs("25", await ownerStore()),
    );
    expect(res).toEqual({
      ok: true,
      clamped: true,
      requestedAmountUsd: 25,
      effectiveAmountUsd: 10,
      effectiveCapUsd: 10,
      transferId: "tr-1",
    });
    // consistency chain: downstream sees ONLY the effective amount.
    expect(kit.spend).toHaveBeenCalledWith(
      expect.objectContaining({ amountUsd: "10", sourceAccount: W }),
    );
  });

  it("under-cap spend on clamp record → no clamp fields (no false marker)", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec({ spendCapUsd: 10, clamp: true }));
    const kit = readyKit();
    const res = await spendAsDelegate(
      store,
      kit,
      spendArgs("5", await ownerStore()),
    );
    expect(res).toEqual({ ok: true, transferId: "tr-1" });
    expect(kit.spend).toHaveBeenCalledWith(
      expect.objectContaining({ amountUsd: "5" }),
    );
  });

  it("AC3: owner tightened perTx after register → clamp binds to the NEW cap", async () => {
    const store = createMemoryDelegateStore();
    // Registered wide (perTx was 500 then), owner later tightened to 10.
    store.put(rec({ spendCapUsd: 500, clamp: true }));
    const kit = readyKit();
    const res = await spendAsDelegate(
      store,
      kit,
      spendArgs("50", await ownerStore(10)),
    );
    expect(res).toMatchObject({
      ok: true,
      clamped: true,
      requestedAmountUsd: 50,
      effectiveAmountUsd: 10,
      effectiveCapUsd: 10,
    });
    expect(kit.spend).toHaveBeenCalledWith(
      expect.objectContaining({ amountUsd: "10" }),
    );
  });

  it("AC4: non-finite/non-positive amount + clamp → deny BEFORE cap-check", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec({ clamp: true }));
    const kit = readyKit();
    const ws = await ownerStore();
    for (const amountUsd of ["0", "-5", "abc", "NaN", "Infinity"]) {
      const res = await spendAsDelegate(store, kit, spendArgs(amountUsd, ws));
      expect(res).toEqual({ ok: false, reason: "cap-exceeded" });
    }
    // Never reaches status check or spend — ordering preserved.
    expect(kit.getDelegateStatus).not.toHaveBeenCalled();
    expect(kit.spend).not.toHaveBeenCalled();
  });

  it("suspended owner + clamp record → delegate-suspended (D1 order)", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec({ clamp: true }));
    const kit = readyKit();
    const ws = createMemoryAgentWalletStore();
    await ws.put({
      address: W,
      label: "owner",
      kind: "eoa",
      envelope: {},
      registeredBy: W,
      createdAt: Date.now(),
      active: true,
      suspended: true,
    });
    const res = await spendAsDelegate(store, kit, spendArgs("25", ws));
    expect(res).toEqual({ ok: false, reason: "delegate-suspended" });
    expect(kit.spend).not.toHaveBeenCalled();
  });

  it("clamped candidate + pending delegate → still delegate-pending (clamp only rescues cap)", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec({ clamp: true }));
    const kit: DelegateSpendKit = {
      getDelegateStatus: vi.fn(async () => "pending" as const),
      spend: vi.fn(async () => ({})),
    };
    const res = await spendAsDelegate(
      store,
      kit,
      spendArgs("25", await ownerStore()),
    );
    expect(res).toEqual({ ok: false, reason: "delegate-pending" });
    expect(kit.spend).not.toHaveBeenCalled();
  });
});

/* ------------------------------- routes ---------------------------------- */

describe("delegate routes — clamp declaration", () => {
  const routes = (walletStore = createMemoryAgentWalletStore()) => {
    const delegateStore = createMemoryDelegateStore();
    const app = createAgentWalletDelegateRoutes({
      delegateStore,
      delegateAddress: DELEGATE,
      walletStore,
      requireRegistered: false,
    });
    return { app, delegateStore };
  };

  const post = async (app: ReturnType<typeof routes>["app"], body: object) => {
    const path = `/api/wallets/${W}/delegate`;
    const raw = JSON.stringify(body);
    return app.request(path, {
      method: "POST",
      headers: { ...(await signed("POST", path, raw)), "Content-Type": "application/json" },
      body: raw,
    });
  };

  it("AC5: clamp:'yes' → 400; clamp:true → record.clamp persisted", async () => {
    const { app, delegateStore } = routes();
    const bad = await post(app, { chain: CHAIN, spendCapUsd: 10, clamp: "yes" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("boolean");

    const ok = await post(app, { chain: CHAIN, spendCapUsd: 10, clamp: true });
    expect(ok.status).toBe(201);
    expect((await ok.json()).record.clamp).toBe(true);
    expect(delegateStore.get(W, CHAIN)?.clamp).toBe(true);
  });

  it("re-register REPLACES the record — new clamp applies, no silent carry", async () => {
    const { app, delegateStore } = routes();
    expect(
      (await post(app, { chain: CHAIN, spendCapUsd: 10, clamp: true })).status,
    ).toBe(201);
    // Second register without clamp → record rewritten, flag gone (D-263-Q2).
    expect(
      (await post(app, { chain: CHAIN, spendCapUsd: 8 })).status,
    ).toBe(201);
    const r = delegateStore.get(W, CHAIN);
    expect(r?.clamp).toBeUndefined();
    expect(r?.spendCapUsd).toBe(8);
  });

  it("AC6: GET /delegate exposes clamp in the record", async () => {
    const { app } = routes();
    await post(app, { chain: CHAIN, spendCapUsd: 10, clamp: true });
    const get = `/api/wallets/${W}/delegate`;
    const res = await app.request(get, { headers: await signed("GET", get) });
    const body = await res.json();
    expect(body.delegates[0].clamp).toBe(true);
  });
});
