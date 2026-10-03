/**
 * SLICE-156-6 tests: unified-balance delegate rail.
 *  - DelegateStore CRUD + revoke idempotence
 *  - spendAsDelegate: no-delegate / cap / pending / ready / revoked
 *  - routes: register (handoff), list (sig), revoke (immediate stop)
 *  - sig auth: 401 no-sig, owner-only (x-wallet must equal :addr)
 */
import { describe, it, expect, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { buildAccessChallenge } from "../src/server/middleware/agent-auth";

import {
  createMemoryDelegateStore,
  spendAsDelegate,
  validateDelegateInput,
  type DelegateRecord,
  type DelegateSpendKit,
  type DelegateStatus,
} from "../src/server/lib/agent-wallet/delegate";
import { createMemoryAgentWalletStore } from "../src/server/lib/agent-wallet/registry";
import { createAgentWalletDelegateRoutes } from "../src/server/routes/agent-wallet-delegate-api";

// Hardhat accounts — well-known test keys, never hold real funds.
const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const stranger = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
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

async function signed(
  method: string,
  path: string,
  account = owner,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await account.signMessage({
    message: buildAccessChallenge({
      wallet: account.address,
      method,
      path,
      timestamp,
    }),
  });
  return {
    "x-wallet": account.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
  };
}

const readyKit = (status: DelegateStatus = "ready"): DelegateSpendKit => ({
  getDelegateStatus: vi.fn(async () => status),
  spend: vi.fn(async () => ({ transferId: "tr-1" })),
});

describe("delegate store + validation", () => {
  it("put/get/list/revoke; revoke idempotent, unknown → false", () => {
    const store = createMemoryDelegateStore();
    store.put(rec());
    store.put(rec({ chain: "Arc_Testnet" }));
    expect(store.get(W, CHAIN)?.spendCapUsd).toBe(10);
    expect(store.list(W)).toHaveLength(2);
    expect(store.revoke(W, CHAIN)).toBe(true);
    expect(store.revoke(W, CHAIN)).toBe(false); // already revoked
    expect(store.revoke(W, "Solana_Devnet")).toBe(false); // unknown
  });

  it("validateDelegateInput rejects bad wallet/cap/chain", () => {
    const base = {
      ownerWallet: W, delegate: DELEGATE, chain: CHAIN, spendCapUsd: 10,
    };
    expect(() =>
      validateDelegateInput({ ...base, ownerWallet: "nope" }),
    ).toThrow("invalid owner wallet");
    expect(() =>
      validateDelegateInput({ ...base, spendCapUsd: 0 }),
    ).toThrow("spendCapUsd");
    expect(() => validateDelegateInput({ ...base, chain: "" })).toThrow(
      "invalid chain",
    );
  });
});

describe("spendAsDelegate", () => {
  const args = {
    ownerWallet: W, chain: CHAIN, amountUsd: "5.00",
    to: { chain: "Arc_Testnet", recipientAddress: W },
  };

  it("no record / revoked → no-active-delegate, kit untouched", async () => {
    const store = createMemoryDelegateStore();
    const kit = readyKit();
    expect(await spendAsDelegate(store, kit, args)).toEqual({
      ok: false,
      reason: "no-active-delegate",
    });
    store.put(rec({ revokedAt: Date.now() }));
    expect((await spendAsDelegate(store, kit, args)).ok).toBe(false);
    expect(kit.spend).not.toHaveBeenCalled();
  });

  it("amount over spendCapUsd → cap-exceeded before status check", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec({ spendCapUsd: 4 }));
    const kit = readyKit();
    const res = await spendAsDelegate(store, kit, args);
    expect(res).toEqual({ ok: false, reason: "cap-exceeded" });
    expect(kit.getDelegateStatus).not.toHaveBeenCalled();
  });

  it("pending delegate → delegate-pending, no spend", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec());
    const res = await spendAsDelegate(store, readyKit("pending"), args);
    expect(res).toEqual({ ok: false, reason: "delegate-pending" });
  });

  it("ready delegate → kit.spend with sourceAccount=owner", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec());
    const kit = readyKit();
    const res = await spendAsDelegate(store, kit, args);
    expect(res).toEqual({ ok: true, transferId: "tr-1" });
    expect(kit.spend).toHaveBeenCalledWith(
      expect.objectContaining({ sourceAccount: W }),
    );
  });

  it("revoke immediately stops spends", async () => {
    const store = createMemoryDelegateStore();
    store.put(rec());
    const kit = readyKit();
    expect((await spendAsDelegate(store, kit, args)).ok).toBe(true);
    store.revoke(W, CHAIN);
    const res = await spendAsDelegate(store, kit, args);
    expect(res).toEqual({ ok: false, reason: "no-active-delegate" });
    expect(kit.spend).toHaveBeenCalledTimes(1); // only the first
  });
});

describe("delegate routes", () => {
  const routes = () =>
    createAgentWalletDelegateRoutes({
      delegateStore: createMemoryDelegateStore(),
      delegateAddress: DELEGATE,
      walletStore: createMemoryAgentWalletStore(),
      requireRegistered: false,
    });

  it("POST register → 201 + verbatim addDelegate handoff", async () => {
    const app = routes();
    const path = `/api/wallets/${W}/delegate`;
    const res = await app.request(path, {
      method: "POST",
      headers: {
        ...await signed("POST", path),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chain: CHAIN, spendCapUsd: 10 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.record.delegate).toBe(DELEGATE);
    expect(body.addDelegate.params.delegateAddress).toBe(DELEGATE);
    expect(body.addDelegate.params.from.chain).toBe(CHAIN);
  });

  it("no sig → 401; x-wallet ≠ :addr → 401; stranger-proof", async () => {
    const app = routes();
    const path = `/api/wallets/${W}/delegate`;
    expect((await app.request(path, { method: "POST" })).status).toBe(401);
    // stranger signs for himself but addresses another wallet's route
    const res = await app.request(path, {
      method: "POST",
      headers: {
        ...await signed("POST", path, stranger),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chain: CHAIN, spendCapUsd: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("register→list→revoke lifecycle; revoke then re-register works", async () => {
    const app = routes();
    const reg = `/api/wallets/${W}/delegate`;
    const post = async () =>
      app.request(reg, {
        method: "POST",
        headers: {
          ...await signed("POST", reg),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chain: CHAIN, spendCapUsd: 10 }),
      });
    expect((await post()).status).toBe(201);

    const get = `/api/wallets/${W}/delegate`;
    const listRes = await app.request(get, {
      headers: await signed("GET", get),
    });
    expect((await listRes.json()).delegates).toHaveLength(1);

    const revoke = `/api/wallets/${W}/delegate/revoke`;
    const revRes = await app.request(revoke, {
      method: "POST",
      headers: {
        ...await signed("POST", revoke),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chain: CHAIN }),
    });
    expect(revRes.status).toBe(200);
    const body = await revRes.json();
    expect(body.removeDelegate.params.delegateAddress).toBe(DELEGATE);
    // second revoke → 404; re-register is a fresh record
    expect(
      (
        await app.request(revoke, {
          method: "POST",
          headers: {
            ...await signed("POST", revoke),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ chain: CHAIN }),
        })
      ).status,
    ).toBe(404);
    expect((await post()).status).toBe(201);
  });
});
