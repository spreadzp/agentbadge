/**
 * SLICE-197-04: passport owner indexer — chunked getLogs over the
 * ERC-8004 identityRegistry Transfer events → `passportOwner`
 * (O7: no Enumerable on registry → onchain list-by-owner impossible).
 * Pattern cloned from venue/indexer.ts: watermark in store meta,
 * reorg rewind, RPC fallback (indexer-rpc.ts), injectable deps so
 * tests drive a fake log source.
 *
 * Resume: watermark meta persists on the json lane; on the prisma
 * lane meta is in-memory, so restart falls back to
 * maxPassportOwnerBlock() − REORG_LOOKBACK — monotonic upserts make
 * the overlap a no-op.
 */
import { decodeEventLog, parseAbi } from "viem";
import type { Abi } from "viem";
import { logger } from "@agentbadge/passport";

import { resolveVenueNetwork, type VenueNetwork } from "../venue/chain";
import {
  defaultGetBlockHash,
  defaultGetHead,
  defaultGetLogs,
  type RawLog,
} from "../venue/indexer-rpc";
import {
  bountyStoreReady,
  getBountyMeta,
  maxPassportOwnerBlock,
  setBountyMeta,
  upsertPassportOwner,
} from "./store";

export type { RawLog } from "../venue/indexer-rpc";

const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const CHUNK = () =>
  Number(
    process.env.BOUNTY_INDEXER_CHUNK_BLOCKS ??
      process.env.ARC_INDEXER_CHUNK_BLOCKS ??
      2000,
  );
const REORG_LOOKBACK = 64;
/** First-ever backfill floor (env override; 0 = from genesis). */
const START_BLOCK = () => Number(process.env.BOUNTY_INDEXER_START_BLOCK ?? 0);

export interface PassportIndexerDeps {
  network?: () => VenueNetwork;
  /** Address-scoped log fetch; production wraps publicClient.getLogs. */
  getLogs?: (
    address: `0x${string}`,
    fromBlock: bigint,
    toBlock: bigint,
  ) => Promise<RawLog[]>;
  getHead?: () => Promise<bigint>;
  /** Block hash for the reorg check; null = block no longer canonical. */
  getBlockHash?: (blockNumber: bigint) => Promise<`0x${string}` | null>;
  /** Scanned contract — defaults to net.identityRegistry (ERC-8004). */
  contract?: () => `0x${string}`;
}

export interface PassportIndexerRun {
  fromBlock: number;
  toBlock: number;
  transfers: number;
  durationMs: number;
}

export function passportIndexerMetaKeys(network: string) {
  return {
    watermark: `passportIdx:${network}:watermark`,
    watermarkHash: `passportIdx:${network}:watermarkHash`,
    lastRun: `passportIdx:${network}:lastRun`,
  } as const;
}

function decodeTransfer(log: RawLog): {
  from: `0x${string}`;
  to: `0x${string}`;
  tokenId: bigint;
} | null {
  try {
    const d = decodeEventLog({
      abi: TRANSFER_ABI as Abi,
      data: log.data,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    });
    if (d.eventName !== "Transfer") return null;
    const args = d.args as unknown as {
      from: `0x${string}`;
      to: `0x${string}`;
      tokenId: bigint;
    };
    return args;
  } catch {
    return null;
  }
}

export async function runPassportIndexer(
  deps: PassportIndexerDeps = {},
): Promise<PassportIndexerRun> {
  await bountyStoreReady();
  const net = (deps.network ?? resolveVenueNetwork)();
  const contract = (
    deps.contract?.() ??
    (process.env.BOUNTY_PASSPORT_CONTRACT as `0x${string}` | undefined) ??
    net.identityRegistry
  );
  const getLogs = deps.getLogs ?? defaultGetLogs(net);
  const getHead = deps.getHead ?? defaultGetHead(net);
  const getBlockHash = deps.getBlockHash ?? defaultGetBlockHash(net);
  const started = Date.now();
  const k = passportIndexerMetaKeys(net.name);

  const head = Number(await getHead());
  let watermark =
    getBountyMeta<number>(k.watermark) ??
    Math.max(
      START_BLOCK(),
      maxPassportOwnerBlock() - REORG_LOOKBACK,
    );
  let reorged = false;

  // Reorg check: stored watermark hash must still be canonical.
  if (watermark > 0) {
    const storedHash = getBountyMeta<string>(k.watermarkHash);
    if (storedHash) {
      const nowHash = await getBlockHash(BigInt(watermark));
      if (nowHash && nowHash !== storedHash) {
        watermark = Math.max(START_BLOCK(), watermark - REORG_LOOKBACK);
        reorged = true;
        logger.warn("passport indexer: reorg detected, rewound watermark", {
          network: net.name,
          watermark,
        });
      }
    }
  }

  const fromBlock = Math.max(START_BLOCK(), watermark + 1);
  const toBlock = head;
  let transfers = 0;
  const chunk = CHUNK();

  for (let from = BigInt(fromBlock); from <= toBlock; from += BigInt(chunk)) {
    const to =
      from + BigInt(chunk) - 1n > BigInt(toBlock)
        ? BigInt(toBlock)
        : from + BigInt(chunk) - 1n;

    const logs = await getLogs(contract, from, to);
    for (const log of logs) {
      const ev = decodeTransfer(log);
      if (!ev) continue;
      transfers++;
      upsertPassportOwner({
        passportId: ev.tokenId.toString(),
        owner: ev.to.toLowerCase(),
        blockNumber: Number(log.blockNumber),
        logIndex: log.logIndex,
        txHash: log.transactionHash ?? undefined,
        payload: {
          from: ev.from,
          to: ev.to,
          tokenId: ev.tokenId.toString(),
        },
      });
    }
  }

  const durationMs = Date.now() - started;
  const headHash = await getBlockHash(BigInt(toBlock));
  setBountyMeta(k.watermark, toBlock);
  if (headHash) setBountyMeta(k.watermarkHash, headHash);
  setBountyMeta(k.lastRun, {
    fromBlock,
    toBlock,
    transfers,
    durationMs,
    at: new Date().toISOString(),
  });

  logger.info("passport indexer: run complete", {
    network: net.name,
    contract,
    fromBlock,
    toBlock,
    transfers,
    durationMs,
    reorged,
  });
  return { fromBlock, toBlock, transfers, durationMs };
}
