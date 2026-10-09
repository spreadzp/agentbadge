/**
 * SLICE-172-2/3: verdict hash-chain assembly for the eaas wiring.
 * Keeps wiring/eaas.ts under the 300-line cap — all chain construction
 * (store + service + head-anchor flusher) lives here.
 *
 * Returns the ChainService for the append-hook (issueVerdict + eval) or
 * undefined when ARC_CHAIN_ENABLED=0. The flusher only starts when a send
 * seam exists (head anchoring needs an EOA; chain appends don't).
 */

import type { Hex } from "viem";
import { logger } from "@agentbadge/passport";
import { createChainService, createJsonChainStore } from "./chain";
import type { ChainService } from "./chain";
import { createChainFlusher } from "./chain-flush";
import type { SendAnchorFn } from "./anchor";

export function setupVerdictChain(deps: {
  enabled: boolean;
  flushMs: number;
  retries: number;
  memo: `0x${string}`;
  /** Present only when an evaluator key exists — head anchoring needs it. */
  send?: SendAnchorFn;
  selfAddress?: Hex;
}): ChainService | undefined {
  if (!deps.enabled) return undefined;
  const store = createJsonChainStore();
  const service = createChainService({ store });
  if (deps.send && deps.selfAddress) {
    createChainFlusher({
      service,
      store,
      memo: deps.memo,
      selfAddress: deps.selfAddress,
      send: deps.send,
      flushMs: deps.flushMs,
      retries: deps.retries,
      backoffMs: 5_000,
    }).start();
  } else {
    logger.warn("EaaS chain ON but no evaluator key — head anchors off");
  }
  return service;
}
