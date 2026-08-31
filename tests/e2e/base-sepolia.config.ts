/**
 * E2E test configuration for Base Sepolia.
 *
 * SLICE-90-10: Reads env vars and constructs BaseConfig for BaseChainAdapter.
 * Test skips gracefully if CHAIN_MODE != base or BASE_OPERATOR_KEY not set.
 */

import {
  BASE_SEPOLIA_ADDRESSES,
  BASE_SEPOLIA_RPC,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_EXPLORER,
  type EvmConfig,
} from "@agentbadge/evm-core";

export function isBaseE2EEnabled(): boolean {
  return (
    process.env.CHAIN_MODE === "base" &&
    !!process.env.BASE_OPERATOR_KEY
  );
}

export function getBaseTestConfig(): EvmConfig {
  const operatorKey = process.env.BASE_OPERATOR_KEY;
  if (!operatorKey) {
    throw new Error("BASE_OPERATOR_KEY not set — cannot run Base Sepolia E2E tests");
  }

  return {
    rpcUrl: process.env.BASE_RPC_URL ?? BASE_SEPOLIA_RPC,
    chainId: Number(process.env.BASE_CHAIN_ID ?? BASE_SEPOLIA_CHAIN_ID),
    operatorKey,
    passportNft: process.env.BASE_PASSPORT_NFT ?? BASE_SEPOLIA_ADDRESSES.AgentPassport,
    escrow: process.env.BASE_TASK_ESCROW ?? BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    eventLog: BASE_SEPOLIA_ADDRESSES.DIDRegistry,
    usdcAddress: process.env.BASE_USDC_ADDRESS ?? BASE_SEPOLIA_ADDRESSES.MockUSDC,
    explorerUrl: process.env.BASE_EXPLORER_URL ?? BASE_SEPOLIA_EXPLORER,
  };
}

export const SKIP_REASON =
  "Skipping: CHAIN_MODE != base or BASE_OPERATOR_KEY not set";
