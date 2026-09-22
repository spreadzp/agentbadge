/**
 * Attestcoin config section (EPIC-140, SLICE-140-25).
 * Always built — `enabled` flag gates the feature inside.
 */

import type { AttestcoinConfig } from "./types";
import { booleanFlag } from "./validators";

export function loadAttestcoin(): AttestcoinConfig {
  return {
    enabled: booleanFlag("ATTESTCOIN_ENABLED"),
    taskEscrowSepoliaAddr: process.env.TASK_ESCROW_SEPOLIA_ADDR ?? "",
    taskMarketplaceAscAddr: process.env.TASK_MARKETPLACE_ASC_ADDR ?? "",
    taskStateAddr: process.env.TASK_STATE_ADDR ?? "",
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL ?? "",
    creditcoinRpcUrl:
      process.env.CREDITCOIN_RPC_URL ??
      "https://rpc.cc3-testnet.creditcoin.network",
    proverUrl:
      process.env.ATTESTCOIN_PROVER_URL ??
      "https://prover.cc3-testnet.creditcoin.network",
  };
}
