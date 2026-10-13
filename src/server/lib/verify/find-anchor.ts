/**
 * Verify-side memo anchor reads — moved out of lib/eaas/anchor.ts
 * (154-4) so the anchor module stays under the file-size gate while
 * the lookup surface lives next to lib/verify/lookup.ts (180-1).
 *
 * createFindAnchor: getLogs(Memo, memoId) → tx + block + memoData +
 * block time. The event-shape decode lives here, next to the send path
 * it verifies.
 */

import type { Hex } from "viem";
import { MEMO_ABI } from "@agentbadge/circle-payments";
import type { AnchorStatus } from "../eaas/anchor";

/** Onchain memo hit — event fields needed by the public verify endpoint. */
export interface AnchorLookupResult {
  txHash: Hex;
  blockNumber: bigint;
  /** Memo event `memo` bytes — must equal AnchorRecord.artifactHash. */
  memoData: Hex;
  blockTime?: number;
}

export type FindAnchorFn = (
  memoId: Hex,
) => Promise<AnchorLookupResult | null>;

/**
 * FindAnchorFn factory — wiring passes the viem publicClient.
 */
export function createFindAnchor(deps: {
  read: {
    getLogs: (a: {
      address: `0x${string}`;
      event: unknown;
      args: { memoId: Hex };
    }) => Promise<
      readonly { transactionHash: Hex; blockNumber: bigint; args: unknown }[]
    >;
    getBlock: (a: {
      blockNumber: bigint;
    }) => Promise<{ timestamp: bigint }>;
  };
  memo: `0x${string}`;
}): FindAnchorFn {
  return async (memoId) => {
    const logs = await deps.read.getLogs({
      address: deps.memo,
      event: MEMO_ABI[2],
      args: { memoId },
    });
    const log = logs[0];
    if (!log) return null;
    const block = await deps.read
      .getBlock({ blockNumber: log.blockNumber })
      .catch(() => null);
    return {
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      memoData: (log.args as { memo: Hex }).memo,
      ...(block ? { blockTime: Number(block.timestamp) } : {}),
    };
  };
}

export interface AnchorVerifyResult {
  signatureValid: boolean;
  signer: Hex;
  chainId: number;
  anchor: {
    status: AnchorStatus | "none";
    found: boolean;
    memoId?: Hex;
    txHash?: Hex;
    contextMatches: boolean;
    blockTime?: number;
  };
}
