/**
 * Base event indexer singleton — manages the EventIndexer instance for Base Sepolia.
 *
 * SLICE-90-11: Event listening & indexing.
 */

import {
  EvmChainAdapter,
  EventIndexer,
  BASE_SEPOLIA_ADDRESSES,
  BASE_SEPOLIA_RPC,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_EXPLORER,
} from "@agentbadge/evm-core";

let indexer: EventIndexer | null = null;

export function getBaseEventIndexer(): EventIndexer {
  if (!indexer) {
    throw new Error("Base event indexer not started — call startBaseEventIndexer() first");
  }
  return indexer;
}

export function startBaseEventIndexer(): void {
  const chainMode = process.env.CHAIN_MODE ?? "hedera";
  if (chainMode !== "base") {
    console.log("[BaseEventIndexer] Skipped — CHAIN_MODE is not 'base'");
    return;
  }

  const operatorKey = process.env.BASE_OPERATOR_KEY;
  if (!operatorKey) {
    console.warn("[BaseEventIndexer] Skipped — BASE_OPERATOR_KEY not set");
    return;
  }

  if (indexer) {
    console.log("[BaseEventIndexer] Already running");
    return;
  }

  const adapter = new EvmChainAdapter({
    rpcUrl: process.env.BASE_RPC_URL ?? BASE_SEPOLIA_RPC,
    chainId: Number(process.env.BASE_CHAIN_ID ?? BASE_SEPOLIA_CHAIN_ID),
    operatorKey,
    passportNft: process.env.BASE_PASSPORT_NFT ?? BASE_SEPOLIA_ADDRESSES.AgentPassport,
    escrow: process.env.BASE_ESCROW_ADDRESS ?? BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    eventLog: BASE_SEPOLIA_ADDRESSES.DIDRegistry,
    usdcAddress: process.env.BASE_USDC_ADDRESS ?? BASE_SEPOLIA_ADDRESSES.MockUSDC,
    explorerUrl: process.env.BASE_EXPLORER_URL ?? BASE_SEPOLIA_EXPLORER,
  });

  indexer = new EventIndexer(adapter, {
    passportAddress: process.env.BASE_PASSPORT_NFT ?? BASE_SEPOLIA_ADDRESSES.AgentPassport,
    escrowAddress: process.env.BASE_ESCROW_ADDRESS ?? BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    pollIntervalMs: Number(process.env.BASE_EVENT_POLL_MS ?? 10000),
  });

  indexer.start();
  console.log("[BaseEventIndexer] Started — polling for events on Base Sepolia");
}

export function stopBaseEventIndexer(): void {
  if (indexer) {
    indexer.stop();
    indexer = null;
    console.log("[BaseEventIndexer] Stopped");
  }
}
