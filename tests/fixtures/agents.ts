import { ethers } from "ethers";
import { setupMockEnv, makeTestApp, makeEvmWallet, signWalletOwnership } from "../e2e/helpers";
import { nftStore, topicMessages } from "@agentbadge/hedera-core";
import { a2aClear as clearA2ACache } from "@agentbadge/passport";
import { clear as clearDirectoryCache } from "@agentbadge/passport";
import { marketClear as clearMarketCache } from "@agentbadge/passport";
import type { Hono } from "hono";

export interface TestAgent {
  did: string;
  tokenId: string;
  serial: number;
  accountId: string;
  name: string;
  wallet: { address: string; privateKey: string };
  app: Hono;
}

/**
 * Create a test agent with a passport via POST /passport/request.
 * Uses MOCK_HEDERA=true for deterministic test behavior.
 */
export async function createTestAgent(name: string, tier: string = "bronze"): Promise<TestAgent> {
  setupMockEnv();
  const app = makeTestApp();
  const wallet = makeEvmWallet();
  const signature = await signWalletOwnership(wallet.privateKey, wallet.address);

  const res = await app.request("/passport/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: wallet.address,
      signature,
      tier,
      name,
      capabilities: ["api_call", "data_provide"],
      endpoint: `https://${name.toLowerCase()}.example.com`,
    }),
  });

  if (res.status !== 200) {
    const text = await res.text();
    throw new Error(`Failed to create test agent ${name}: ${res.status} ${text}`);
  }

  const body = await res.json();
  return {
    did: body.did,
    tokenId: body.tokenId,
    serial: body.serialNumber,
    accountId: wallet.address,
    name,
    wallet,
    app,
  };
}

/**
 * Revoke a test agent's passport via POST /admin/revoke.
 * Cleans up after tests.
 */
export async function revokeTestAgent(agent: TestAgent): Promise<void> {
  const res = await agent.app.request("/admin/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": "test-admin-key",
    },
    body: JSON.stringify({
      tokenId: agent.tokenId,
      serial: agent.serial,
      reason: "E2E test cleanup",
    }),
  });

  if (res.status !== 200) {
    // Best-effort cleanup — don't throw
    console.warn(`Failed to revoke test agent ${agent.name}: ${res.status}`);
  }
}

/**
 * Clear all test state: mock NFT store, topic messages, caches.
 */
export function resetTestState(): void {
  setupMockEnv();
  nftStore.clear();
  topicMessages.clear();
  clearA2ACache();
  clearDirectoryCache();
  clearMarketCache();
}
