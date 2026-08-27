/**
 * Base event indexer singleton — manages the EventIndexer instance for Base Sepolia.
 *
 * SLICE-90-11: Event listening & indexing.
 */

// TODO(EPIC-90): re-enable when base-core is published to npm
// import {
//   BaseChainAdapter,
//   EventIndexer,
//   BASE_SEPOLIA_ADDRESSES,
//   BASE_SEPOLIA_RPC,
//   BASE_SEPOLIA_CHAIN_ID,
//   BASE_SEPOLIA_EXPLORER,
// } from "@agentgate-hedera/base-core";

// let indexer: EventIndexer | null = null;

export function getBaseEventIndexer(): never {
  throw new Error("Base event indexer not available — base-core not deployed yet");
}

export function startBaseEventIndexer(): void {
  console.log("[BaseEventIndexer] Skipped — base-core not deployed yet");
}

export function stopBaseEventIndexer(): void {
  // no-op
}
