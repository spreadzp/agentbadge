/**
 * SLICE-152-5: indexer RPC layer — viem getLogs/getBlockNumber/getBlock
 * wrappers with URL fallback (ARC_INDEXER_URL → ARC_INDEXER_FALLBACK_URL →
 * net.chain.rpcUrl). Split out of indexer.ts (max-lines).
 */
import { createPublicClient, http } from "viem";
import { logger } from "@agentbadge/passport";

import type { VenueNetwork } from "./chain";

export interface RawLog {
  address: `0x${string}`;
  topics: `0x${string}`[];
  data: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}` | null;
  transactionHash: `0x${string}` | null;
  logIndex: number;
}

export interface IndexerRpcDeps {
  getLogs: (
    address: `0x${string}`,
    fromBlock: bigint,
    toBlock: bigint,
  ) => Promise<RawLog[]>;
  getHead: () => Promise<bigint>;
  /** Block hash for the reorg check; null = block no longer canonical. */
  getBlockHash: (blockNumber: bigint) => Promise<`0x${string}` | null>;
}

function indexerRpcUrls(net: VenueNetwork): string[] {
  return [
    process.env.ARC_INDEXER_URL,
    process.env.ARC_INDEXER_FALLBACK_URL,
    net.chain.rpcUrl,
  ].filter((u): u is string => Boolean(u));
}

function makeClient(rpcUrl: string) {
  return createPublicClient({ transport: http(rpcUrl, { timeout: 30_000 }) });
}

async function tryUrls<T>(
  net: VenueNetwork,
  fn: (rpcUrl: string) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (const url of indexerRpcUrls(net)) {
    try {
      return await fn(url);
    } catch (err) {
      lastErr = err;
      logger.warn("venue indexer: RPC call failed, trying next URL", {
        url,
        err: String(err).slice(0, 200),
      });
    }
  }
  throw lastErr ?? new Error("no RPC configured");
}

/** getLogs with RPC fallback: primary → fallback → chain rpcUrl. */
export function defaultGetLogs(net: VenueNetwork): IndexerRpcDeps["getLogs"] {
  return (address, fromBlock, toBlock) =>
    tryUrls(net, (url) =>
      makeClient(url)
        .getLogs({ address, fromBlock, toBlock })
        .then((logs) => logs as unknown as RawLog[]),
    );
}

export function defaultGetHead(net: VenueNetwork): IndexerRpcDeps["getHead"] {
  return () => tryUrls(net, (url) => makeClient(url).getBlockNumber());
}

export function defaultGetBlockHash(
  net: VenueNetwork,
): IndexerRpcDeps["getBlockHash"] {
  return (n) =>
    tryUrls(net, (url) =>
      makeClient(url)
        .getBlock({ blockNumber: n })
        .then((b) => b.hash),
    ).catch(() => null);
}
