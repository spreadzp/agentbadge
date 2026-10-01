/**
 * SLICE-152-5: venue event indexer — chunked getLogs over the ACP contract
 * (JobCreated) + Memo contract (Memo where target ∈ venue contracts),
 * watermark in VenueStore meta, reorg rewind, RPC fallback.
 *
 * Read path design (D5-152): /market and /api/venue/* serve from the local
 * index; onchain reads stay per-job verification only. Arc finality is ~1s
 * so confirmations=1 is sufficient — we still store the watermark blockHash
 * and rewind REORG_LOOKBACK blocks when it no longer matches.
 *
 * Deps are injectable: tests drive a fake log source; production defaults to
 * viem publicClient.getLogs on ARC_INDEXER_URL (fallback
 * ARC_INDEXER_FALLBACK_URL) → net.chain.rpcUrl (indexer-rpc.ts).
 */
import { decodeEventLog, keccak256, toBytes } from "viem";
import type { Abi } from "viem";
import { logger } from "@agentbadge/passport";
import { MEMO_ABI } from "@agentbadge/circle-payments";

import {
  fetchOnchainJob,
  resolveVenueNetwork,
  type OnchainJob,
  type VenueNetwork,
} from "./chain";
import {
  defaultGetBlockHash,
  defaultGetHead,
  defaultGetLogs,
  type RawLog,
} from "./indexer-rpc";
import {
  getVenueMeta,
  listJobs,
  setVenueMeta,
  upsertJob,
  venueStoreReady,
  type VenueJob,
} from "./store";
import { recordVenueEvent } from "../../services/venue-events";

export type { RawLog } from "./indexer-rpc";

export interface VenueIndexerDeps {
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
  /** Status enrichment for indexed jobs (getJob pull). */
  onchainJob?: (id: number, net: VenueNetwork) => Promise<OnchainJob | null>;
}

export interface VenueIndexerRun {
  fromBlock: number;
  toBlock: number;
  matched: number;
  durationMs: number;
}

const CHUNK = () => Number(process.env.ARC_INDEXER_CHUNK_BLOCKS ?? 2000);
const REORG_LOOKBACK = 64;

// ─── meta keys ───────────────────────────────────────────────────

export function indexerMetaKeys(network: string) {
  return {
    watermark: `indexer:${network}:watermark`,
    watermarkHash: `indexer:${network}:watermarkHash`,
    lastRun: `indexer:${network}:lastRun`,
  } as const;
}

// ─── decode helpers ──────────────────────────────────────────────

interface DecodedEvent {
  eventName: string;
  args: Record<string, unknown>;
}

function tryDecode(abi: Abi, log: RawLog): DecodedEvent | null {
  try {
    const d = decodeEventLog({
      abi,
      data: log.data,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    });
    if (!d.eventName) return null;
    return {
      eventName: d.eventName,
      args: (d.args ?? {}) as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

const STATUS_BY_NUMBER: Record<number, VenueJob["status"]> = {
  0: "pending",
  1: "open",
  2: "funded",
  3: "submitted",
  4: "completed",
  5: "rejected",
  6: "expired",
};

/** Feedback memoIds we emit — memoIdFor("venue-feedback", tag, jobId). */
const FEEDBACK_TAGS = ["venue-job", "venue-client"];

function memoIdFor(...parts: (string | bigint)[]): `0x${string}` {
  return keccak256(toBytes(parts.join(":")));
}

/** Best-effort jobId link for a Memo event via our feedback memoId shape. */
function linkMemoToJob(memoId: string, jobs: VenueJob[]): string | undefined {
  for (const job of jobs) {
    for (const tag of FEEDBACK_TAGS) {
      if (memoIdFor("venue-feedback", tag, job.jobId) === memoId) {
        return job.jobId;
      }
    }
  }
  return undefined;
}

// ─── indexer run ─────────────────────────────────────────────────

export async function runVenueIndexer(
  deps: VenueIndexerDeps = {},
): Promise<VenueIndexerRun> {
  await venueStoreReady();
  const net = (deps.network ?? resolveVenueNetwork)();
  const getLogs = deps.getLogs ?? defaultGetLogs(net);
  const getHead = deps.getHead ?? defaultGetHead(net);
  const getBlockHash = deps.getBlockHash ?? defaultGetBlockHash(net);
  const onchainJob = deps.onchainJob ?? fetchOnchainJob;
  const started = Date.now();
  const k = indexerMetaKeys(net.name);

  const head = Number(await getHead());
  let watermark = getVenueMeta<number>(k.watermark) ?? 0;
  let reorged = false;

  // Reorg check: stored watermark hash must still be canonical.
  if (watermark > 0) {
    const storedHash = getVenueMeta<string>(k.watermarkHash);
    if (storedHash) {
      const nowHash = await getBlockHash(BigInt(watermark));
      if (nowHash && nowHash !== storedHash) {
        watermark = Math.max(0, watermark - REORG_LOOKBACK);
        reorged = true;
        logger.warn("venue indexer: reorg detected, rewound watermark", {
          network: net.name,
          watermark,
        });
      }
    }
  }

  const fromBlock = watermark + 1;
  const toBlock = head;
  let matched = 0;
  const chunk = CHUNK();
  const venueTargets = new Set(
    [net.agenticCommerce, net.reputationRegistry].map((a) => a.toLowerCase()),
  );

  for (let from = BigInt(fromBlock); from <= toBlock; from += BigInt(chunk)) {
    const to =
      from + BigInt(chunk) - 1n > BigInt(toBlock)
        ? BigInt(toBlock)
        : from + BigInt(chunk) - 1n;

    const [acpLogs, memoLogs] = await Promise.all([
      getLogs(net.agenticCommerce, from, to),
      getLogs(net.memo, from, to),
    ]);

    for (const log of acpLogs) {
      const ev = tryDecode(net.abi as Abi, log);
      if (!ev) continue;
      if (ev.eventName === "JobCreated") {
        matched++;
        await indexJobCreated(ev.args, log, net, onchainJob);
      }
    }

    for (const log of memoLogs) {
      const ev = tryDecode(MEMO_ABI as Abi, log);
      if (!ev || ev.eventName !== "Memo") continue;
      const target = String(ev.args.target ?? "").toLowerCase();
      if (!venueTargets.has(target)) continue;
      matched++;
      const jobId = linkMemoToJob(String(ev.args.memoId), listJobs());
      void recordVenueEvent({
        action: "indexer.memo",
        text: `memo ${String(ev.args.memoId).slice(0, 18)}… → ${target.slice(0, 10)}…`,
        jobId,
        tx: log.transactionHash ?? undefined,
        dedupeKey: `indexer.memo:${log.transactionHash}:${log.logIndex}`,
      });
    }
  }

  const durationMs = Date.now() - started;
  const headHash = await getBlockHash(BigInt(toBlock));
  setVenueMeta(k.watermark, toBlock);
  if (headHash) setVenueMeta(k.watermarkHash, headHash);
  setVenueMeta(k.lastRun, {
    fromBlock,
    toBlock,
    matched,
    durationMs,
    at: new Date().toISOString(),
  });

  logger.info("venue indexer: run complete", {
    network: net.name,
    fromBlock,
    toBlock,
    matched,
    durationMs,
    reorged,
  });
  return { fromBlock, toBlock, matched, durationMs };
}

type OnchainJobFn = NonNullable<VenueIndexerDeps["onchainJob"]>;

/** Upsert a local record for a JobCreated event. */
async function indexJobCreated(
  args: Record<string, unknown>,
  log: RawLog,
  net: VenueNetwork,
  onchainJob: OnchainJobFn,
): Promise<void> {
  const onchainId = Number(args.jobId);
  const txHash = log.transactionHash ?? undefined;

  // Link to an existing local job (posted via API) by onchainJobId,
  // else create the index record so /market shows it (D5-152).
  const existing = listJobs().find((j) => j.onchainJobId === onchainId);
  const onchain = onchainJob ? await onchainJob(onchainId, net) : null;
  const status = onchain ? STATUS_BY_NUMBER[onchain.status] ?? "open" : "open";

  const job: VenueJob = existing ?? {
    jobId: `vj_idx_${onchainId}`,
    onchainJobId: onchainId,
    title: `Indexed job #${onchainId}`,
    description: "",
    budgetUsdc: onchain ? Number(onchain.budget) / 1e6 : 0,
    status,
    client: String(args.client ?? ""),
    provider: String(args.provider ?? ""),
    evaluator: String(args.evaluator ?? ""),
    createdAt: new Date().toISOString(),
    chainTxs: {},
  };
  job.status = status;
  job.onchainJobId = onchainId;
  if (txHash) job.chainTxs.created = txHash;
  upsertJob(job);

  void recordVenueEvent({
    action: "indexer.job",
    text: `job #${onchainId} indexed (${status})`,
    jobId: job.jobId,
    tx: txHash,
    dedupeKey: `indexer.job:${onchainId}:${txHash}`,
  });
}

export { venueStats, venueIndexerHealth } from "./venue-stats";
export type { VenueStats, VenueIndexerHealth } from "./venue-stats";
