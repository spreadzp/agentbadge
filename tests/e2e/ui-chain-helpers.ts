/**
 * E2E helpers for UI chain-mode tests (SLICE-90-24).
 *
 * Provides functions to set up env vars for Hedera and Base chain modes,
 * reset config cache, and create a test app for HTTP requests.
 */

import { resetConfigCache } from "../../src/config/env";
import { makeTestApp, setupMockEnv } from "./helpers";
import type { Hono } from "hono";

/**
 * Set env vars for Hedera mode.
 * All required fields for loadConfig() with chainMode="hedera" are set.
 */
export function setupHederaEnv(): void {
  setupMockEnv();
  process.env.CHAIN_MODE = "hedera";
  process.env.HEDERA_NETWORK = "testnet";
  process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
  process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420test-key-for-mock-mode-only-not-real";
  process.env.PASSPORT_TOKEN_ID = "0.0.9681741";
  process.env.AUDIT_TOPIC_ID = "0.0.9681981";
  process.env.DIRECTORY_TOPIC_ID = "0.0.9681982";
  process.env.x402_FACILITATOR_URL = "https://example.com/facilitator";
  process.env.x402_FEE_PAYER = "0.0.1234";
  process.env.x402_TREASURY = "0.0.5678";
  process.env.IPFS_API_KEY = "test-ipfs-key";
  process.env.IPFS_API_SECRET = "test-ipfs-secret";
  // Clear any base-specific env vars
  delete process.env.BASE_RPC_URL;
  delete process.env.BASE_OPERATOR_KEY;
  delete process.env.BASE_PASSPORT_NFT;
  delete process.env.BASE_TASK_ESCROW;
  delete process.env.BASE_USDC_ADDRESS;
  resetConfigCache();
}

/**
 * Set env vars for Base mode.
 * All required fields for loadConfig() with chainMode="base" are set.
 */
export function setupBaseEnv(): void {
  setupMockEnv();
  process.env.CHAIN_MODE = "base";
  process.env.BASE_RPC_URL = "https://sepolia.base.org";
  process.env.BASE_OPERATOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
  process.env.BASE_TASK_ESCROW = "0x7a3f4b2c8d5e6a1b9c0d3e2f4a5b6c7d8e9f0a1b";
  process.env.BASE_USDC_ADDRESS = "0x1c7d4b196d0b6f5a4c3e2d1f0a9b8c7d6e5f4a3b";
  process.env.BASE_EXPLORER_URL = "https://sepolia.basescan.org";
  // Clear Hedera-specific env vars that might cause confusion
  delete process.env.HEDERA_OPERATOR_KEY;
  delete process.env.x402_FACILITATOR_URL;
  delete process.env.x402_FEE_PAYER;
  delete process.env.x402_TREASURY;
  delete process.env.IPFS_API_KEY;
  delete process.env.IPFS_API_SECRET;
  resetConfigCache();
}

/**
 * Create a test app and return it along with a fetch helper.
 */
export function createUiTestApp(): { app: Hono; fetchPage: (path: string) => Promise<{ status: number; text: string }> } {
  const app = makeTestApp();
  return {
    app,
    fetchPage: async (path: string) => {
      const res = await app.request(path, { method: "GET" });
      const text = await res.text();
      return { status: res.status, text };
    },
  };
}

/**
 * Chain-specific strings that should NOT appear in the other chain's UI.
 */
export const HEDERA_ONLY_STRINGS = [
  "HBAR",
  "HashScan",
  "Hedera Account ID",
  "0.0.xxxx",
  "hashscan.io",
];

export const BASE_ONLY_STRINGS = [
  "USDC",
  "Basescan",
  "Wallet Address",
  "0x...",
  "basescan.org",
];

/**
 * Chain-specific strings that SHOULD appear in each chain's UI.
 */
export const HEDERA_EXPECTED_STRINGS = [
  "Hedera Testnet",
  "HBAR",
  "HashScan",
];

export const BASE_EXPECTED_STRINGS = [
  "Base Sepolia",
  "USDC",
  "Basescan",
];
