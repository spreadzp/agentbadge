/**
 * Chain adapter factory — selects the correct ChainAdapter at runtime
 * based on the CHAIN_MODE environment variable.
 *
 * SLICE-90-16
 */

import type { ChainAdapter } from "@agentgate-hedera/hedera-core";
import { hederaChainAdapter } from "@agentgate-hedera/hedera-core";

export type ChainMode = "hedera" | "base";

let cachedAdapter: ChainAdapter | null = null;

/**
 * Get the chain mode from environment.
 * Defaults to "hedera" if not set.
 */
export function getChainMode(): ChainMode {
  const mode = process.env.CHAIN_MODE ?? "hedera";
  if (mode !== "hedera" && mode !== "base") {
    throw new Error(
      `Invalid CHAIN_MODE="${mode}". Valid values: "hedera", "base".`,
    );
  }
  return mode as ChainMode;
}

/**
 * Get the ChainAdapter instance for the current CHAIN_MODE.
 * The adapter is cached after first creation.
 *
 * - CHAIN_MODE=hedera (default): returns HederaChainAdapter singleton
 * - CHAIN_MODE=base: returns EvmChainAdapter configured from env vars
 */
export async function getChainAdapter(): Promise<ChainAdapter> {
  if (cachedAdapter) return cachedAdapter;

  const mode = getChainMode();

  if (mode === "hedera") {
    cachedAdapter = hederaChainAdapter;
    return cachedAdapter;
  }

  // CHAIN_MODE=base — dynamic import to avoid circular dependency
  // and to allow hedera-only deployments without evm-core installed
  const { EvmChainAdapter, BASE_SEPOLIA_RPC, BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_EXPLORER, BASE_SEPOLIA_ADDRESSES } =
    await import("@agentgate-hedera/evm-core");

  const operatorKey = process.env.BASE_OPERATOR_KEY;
  if (!operatorKey) {
    throw new Error(
      "CHAIN_MODE=base requires BASE_OPERATOR_KEY environment variable",
    );
  }

  const adapter: ChainAdapter = new EvmChainAdapter({
    rpcUrl: process.env.BASE_RPC_URL ?? BASE_SEPOLIA_RPC,
    chainId: Number(process.env.BASE_CHAIN_ID ?? BASE_SEPOLIA_CHAIN_ID),
    operatorKey,
    passportNft: process.env.BASE_PASSPORT_NFT ?? BASE_SEPOLIA_ADDRESSES.AgentPassport,
    escrow: process.env.BASE_ESCROW_ADDRESS ?? BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    eventLog: process.env.BASE_EVENT_LOG ?? BASE_SEPOLIA_ADDRESSES.DIDRegistry,
    usdcAddress: process.env.BASE_USDC_ADDRESS ?? BASE_SEPOLIA_ADDRESSES.MockUSDC,
    explorerUrl: process.env.BASE_EXPLORER_URL ?? BASE_SEPOLIA_EXPLORER,
  });

  cachedAdapter = adapter;
  return adapter;
}

/**
 * Reset the cached adapter. Useful for testing.
 */
export function resetChainAdapter(): void {
  cachedAdapter = null;
}
