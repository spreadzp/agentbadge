/**
 * Base event indexer singleton — manages the EventIndexer instance for Base Sepolia.
 *
 * SLICE-90-11: Event listening & indexing.
 */

import {
  BaseChainAdapter,
  EventIndexer,
  BASE_SEPOLIA_ADDRESSES,
  BASE_SEPOLIA_RPC,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_EXPLORER,
} from "@agentgate-hedera/base-core";

let indexer: EventIndexer | null = null;

export function getBaseEventIndexer(): EventIndexer {
  if (indexer) return indexer;

  const operatorKey = process.env.BASE_OPERATOR_KEY;
  if (!operatorKey) {
    throw new Error("BASE_OPERATOR_KEY not configured");
  }

  const adapter = new BaseChainAdapter({
    rpcUrl: BASE_SEPOLIA_RPC,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    operatorKey,
    passportNft: BASE_SEPOLIA_ADDRESSES.AgentPassport,
    taskEscrow: BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    usdcAddress: BASE_SEPOLIA_ADDRESSES.MockUSDC,
    explorerUrl: BASE_SEPOLIA_EXPLORER,
  });

  indexer = new EventIndexer(adapter, {
    passportAddress: BASE_SEPOLIA_ADDRESSES.AgentPassport,
    escrowAddress: BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    pollIntervalMs: 15_000,
  });

  return indexer;
}

export function startBaseEventIndexer(): void {
  try {
    const idx = getBaseEventIndexer();
    idx.start();
    console.log("[BaseEventIndexer] Started polling for events");
  } catch (e) {
    console.warn("[BaseEventIndexer] Failed to start:", e);
  }
}

export function stopBaseEventIndexer(): void {
  if (indexer) {
    indexer.stop();
    console.log("[BaseEventIndexer] Stopped");
  }
}
