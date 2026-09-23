/**
 * SLICE-141-13 доп.: cache-backed replay protection for Arc self-settle.
 *
 * - CacheTxHashStore.claim → atomic `incr("arc:tx:{hash}")` — first
 *   claim true, replay false; no TTL (restart-safe on Upstash).
 * - Parallel claims with the same txHash → exactly one wins (TOCTOU).
 * - CACHE_ENABLED unset → getCache() yields InMemoryCache — same
 *   semantics, per-process (zero behavior change).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryCache } from "@agentbadge/cache";
import { loadConfig, resetConfigCache } from "../src/config/env";
import { getCache, resetCacheForTests } from "../src/server/lib/cache";
import { CacheTxHashStore } from "../src/server/lib/bstock/tx-hash-store";
import { createArcBstockFacilitator } from "../src/server/lib/bstock/arc-facilitator";

const REQUIRED_ENV: Record<string, string> = {
  HEDERA_OPERATOR_ID: "0.0.5266613",
  HEDERA_OPERATOR_KEY: "302e020100300506032b657004220420abcdef",
  HEDERA_NETWORK: "testnet",
  PASSPORT_TOKEN_ID: "0.0.1234567",
  AUDIT_TOPIC_ID: "0.0.7654321",
  DIRECTORY_TOPIC_ID: "0.0.8765432",
  x402_FACILITATOR_URL: "https://api.testnet.blocky402.com",
  x402_FEE_PAYER: "0.0.7162784",
  x402_TREASURY: "0.0.8011510",
  IPFS_API_KEY: "test-key",
  IPFS_API_SECRET: "test-secret",
  PORT: "4021",
};

const TX =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("CacheTxHashStore", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    delete process.env.CACHE_ENABLED;
    resetConfigCache();
    resetCacheForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetCacheForTests();
  });

  it("claim: first true, replay false, key lowercased", async () => {
    const store = new CacheTxHashStore(new InMemoryCache());
    expect(await store.claim("0xABCD")).toBe(true);
    expect(await store.claim("0xabcd")).toBe(false);
    expect(await store.claim("0xABCD")).toBe(false);
    expect(await store.claim("0xef01")).toBe(true);
  });

  it("parallel claims with same txHash — exactly one wins (TOCTOU)", async () => {
    const store = new CacheTxHashStore(new InMemoryCache());
    const results = await Promise.all([
      store.claim(TX),
      store.claim(TX),
      store.claim(TX),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("CACHE_ENABLED unset → getCache() InMemoryCache, claim still works", async () => {
    expect(loadConfig().cache).toBeUndefined();
    const store = new CacheTxHashStore(getCache());
    expect(await store.claim(TX)).toBe(true);
    expect(await store.claim(TX)).toBe(false);
  });

  it("arc facilitator default path: CacheTxHashStore + fake receipt → replay rejected", async () => {
    const SELLER = "0x2222222222222222222222222222222222222222";
    const BUYER = "0x3333333333333333333333333333333333333333";
    const TRANSFER_TOPIC =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const pad32 = (a: string) =>
      `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
    const receipt = {
      status: "success",
      transactionHash: TX,
      logs: [
        {
          address: "0x3600000000000000000000000000000000000000",
          topics: [TRANSFER_TOPIC, pad32(BUYER), pad32(SELLER)],
          data: `0x${(1000n).toString(16).padStart(64, "0")}`,
        },
      ],
    };
    const publicClient = {
      getTransactionReceipt: async () => receipt,
    };
    const facilitator = createArcBstockFacilitator({
      sellerAddress: SELLER,
      txHashStore: new CacheTxHashStore(getCache()),
      publicClient,
    });
    const req = {
      scheme: "eip3009-client-broadcast",
      network: "eip155:5042002",
      asset: "0x3600000000000000000000000000000000000000",
      amount: "1000",
      maxAmountRequired: "1000",
      payTo: SELLER,
      resource: "POST /mcp/bstock",
      description: "test",
      mimeType: "application/json",
    };
    const sig = Buffer.from(
      JSON.stringify({ payload: { txHash: TX } }),
    ).toString("base64");
    const first = await facilitator.verify(sig, req);
    expect(first.valid).toBe(true);
    const second = await facilitator.verify(sig, req);
    expect(second.valid).toBe(false);
    expect(second.error).toBe("tx_replayed");
  });

  it("RPC failure in verify → invalid (402), not a thrown 500", async () => {
    const facilitator = createArcBstockFacilitator({
      sellerAddress: "0x2222222222222222222222222222222222222222",
      txHashStore: new CacheTxHashStore(getCache()),
      publicClient: {
        getTransactionReceipt: async () => {
          throw new Error("fetch failed");
        },
      },
    });
    const sig = Buffer.from(
      JSON.stringify({ payload: { txHash: TX } }),
    ).toString("base64");
    const res = await facilitator.verify(sig, {
      scheme: "eip3009-client-broadcast",
      network: "eip155:5042002",
      asset: "0x3600000000000000000000000000000000000000",
      amount: "1000",
      maxAmountRequired: "1000",
      payTo: "0x2222222222222222222222222222222222222222",
      resource: "POST /mcp/bstock",
      description: "test",
      mimeType: "application/json",
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("verify_failed");
    // txHash must NOT be claimed — a retry after RPC recovery works.
    const store = new CacheTxHashStore(getCache());
    expect(await store.claim(TX)).toBe(true);
  });
});
