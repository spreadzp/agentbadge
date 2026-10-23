/**
 * SLICE-204-4: payment-forensics indexer — backfill + live-tail + seam seed.
 *
 * What it indexes (spike verdict 204-1):
 *  - settle marker: `AuthorizationUsed` @ USDC `0x3600…` — a tx with ≥1
 *    such log is a "settle tx" (covers Gateway batch + arc self-settle).
 *  - payment edge: the paired ERC-20 `Transfer` @ `0x3600…` INSIDE a
 *    settle tx. topics[1]=from(=authorizer=payer), topics[2]=to=seller.
 *    Generic USDC transfers are NOT payments — landmine: never index a
 *    Transfer outside a settle tx. EIP-7708 mirror logs at
 *    `0xffff…fffe` are filtered out by the address filter (same
 *    transfers, wei-denominated dupes).
 *
 * Persistence: `db.forensics` stores (SLICE-204-3) — PG or in-memory.
 * Cursor semantic: stores the last PROCESSED block; resume = cursor+1.
 * Ordering batch-write → cursor-write makes crash-recovery safe
 * (re-scan of an uncommitted range is dedup'd by the unique edge key).
 *
 * Retention (spike): public RPC is short-retention (~2 days); deep
 * backfill is impossible and getLogs on pruned ranges errors — the
 * indexer logs + stops WITHOUT advancing the cursor (honest retry
 * next tick, never silent data loss).
 *
 * Env: FORENSICS_ENABLED (default on — DATABASE_ENABLED=off makes it a
 * warned no-op), FORENSICS_CHAINS ("5042,5042002"), FORENSICS_START_BLOCK
 * (default: tip − FORENSICS_LOOKBACK_BLOCKS), FORENSICS_BATCH_BLOCKS
 * (10_000 — spike: ≤100k ok, 200k+ errors), FORENSICS_REORG_BLOCKS (64),
 * FORENSICS_POLL_MS (15_000), FORENSICS_LOOKBACK_BLOCKS (100_000),
 * FORENSICS_FUNDING_LOOKBACK (200_000), FORENSICS_PUBLIC_SOURCES
 * (CSV "0xaddr:kind"), ARC_RPC_URL / ARC_MAINNET_RPC_URL.
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import type {
  ForensicsEdgeInsert,
  ForensicsStores,
} from "@agentbadge/database";
import { getDatabase } from "../database.js";
import { logger } from "@agentbadge/passport/logger";

export const USDC_ARC =
  "0x3600000000000000000000000000000000000000" as const;

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
export const AUTH_USED_TOPIC =
  "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5" as const;

/** viem event items — used for the events/args getLogs encoding (raw
 *  topics are not part of viem's typed getLogs API). */
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const AUTH_USED_EVENT = parseAbiItem(
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
);

/** Log shape the indexer needs — subset of viem Log, mock-friendly. */
export interface ForensicsLog {
  address: string;
  topics: readonly string[];
  data: string;
  transactionHash: string | null;
  blockNumber: bigint | null;
  logIndex: number | null;
}

export interface ForensicsLogsClient {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: string;
    topics: (string | string[] | null)[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<ForensicsLog[]>;
}

/** Seam-settled payment (CrosschainPayment-compatible subset). */
export interface SeamSettleEntry {
  payer: string;
  payTo: string;
  /** USD string "5.00" or atomic string — resolved per entry. */
  amountUsd?: string;
  amountAtomic?: string;
  settleTx: string;
  /** CAIP-2 "eip155:5042" — or empty to attribute to this chain. */
  sourceChain?: string;
  settledAt?: number; // ms
}

const topicAddr = (t: string | undefined): string =>
  `0x${(t ?? "").slice(-40)}`.toLowerCase();
const hexToBig = (d: string): bigint => (d ? BigInt(d) : 0n);
const pad32 = (addr: string): string =>
  `0x${"0".repeat(24)}${addr.toLowerCase().replace(/^0x/, "")}`;

/**
 * Pure: logs → settle edges. A tx is a settle tx iff it contains ≥1
 * AuthorizationUsed@USDC; each Transfer@USDC inside it is a payment edge
 * (topics[1]=payer per EIP-3009 — authorizer, not submitter).
 */
export function extractSettleEdges(
  logs: ForensicsLog[],
  chain: string,
  usdcAddress: string = USDC_ARC,
): ForensicsEdgeInsert[] {
  const usdc = usdcAddress.toLowerCase();
  const authTxs = new Set<string>();
  for (const l of logs) {
    if (
      l.address.toLowerCase() === usdc &&
      l.topics[0] === AUTH_USED_TOPIC &&
      l.transactionHash
    ) {
      authTxs.add(l.transactionHash.toLowerCase());
    }
  }
  const edges: ForensicsEdgeInsert[] = [];
  for (const l of logs) {
    if (
      l.address.toLowerCase() !== usdc ||
      l.topics[0] !== TRANSFER_TOPIC ||
      !l.transactionHash ||
      l.blockNumber == null ||
      !authTxs.has(l.transactionHash.toLowerCase())
    ) {
      continue;
    }
    edges.push({
      chain,
      payer: topicAddr(l.topics[1]),
      seller: topicAddr(l.topics[2]),
      amountAtomic: hexToBig(l.data),
      txHash: l.transactionHash,
      blockNumber: l.blockNumber,
      source: "chain",
      ts: 0n, // block ts not required by the forensics rules — resolved lazily if needed
    });
  }
  return edges;
}

/** Pure: seam-settled entries → edges with source="seam" (idempotent by unique key). */
export function seamEntriesToEdges(
  entries: SeamSettleEntry[],
  chain: string,
): ForensicsEdgeInsert[] {
  const out: ForensicsEdgeInsert[] = [];
  for (const e of entries) {
    const entryChain = e.sourceChain?.match(/^eip155:(\d+)$/)?.[1] ?? chain;
    if (entryChain !== chain) continue;
    const amountAtomic = e.amountAtomic
      ? BigInt(e.amountAtomic)
      : BigInt(Math.round(Number(e.amountUsd ?? "0") * 1e6));
    out.push({
      chain,
      payer: e.payer.toLowerCase(),
      seller: e.payTo.toLowerCase(),
      amountAtomic,
      txHash: e.settleTx.toLowerCase(),
      blockNumber: 0n,
      source: "seam",
      ts: BigInt(Math.floor((e.settledAt ?? 0) / 1000)),
    });
  }
  return out;
}

export interface ForensicsIndexerDeps {
  client: ForensicsLogsClient;
  stores: ForensicsStores;
  chain: string;
  usdcAddress?: string;
  /** Explicit start for a fresh cursor; undefined → tip − lookbackBlocks. */
  startBlock?: bigint;
  lookbackBlocks?: bigint;
  batchBlocks?: bigint;
  reorgBlocks?: bigint;
  pollMs?: number;
  /** funder addr (lowercase) → source kind; custody_provider kills the
   *  shared-funder false-positive (D-204-2). */
  publicSources?: ReadonlyMap<string, string>;
  fundingLookbackBlocks?: bigint;
  log?: Pick<typeof logger, "info" | "warn" | "error">;
}

export interface ForensicsIndexer {
  /** Backfill/sync from cursor (or startBlock) to tip. Returns last synced block. */
  sync(opts?: { reorgWindow?: bigint }): Promise<bigint | null>;
  /** One live-tail tick: re-scan reorg window + new blocks. */
  liveTick(): Promise<bigint | null>;
  /** Backfill then poll-loop the tail until stop(). */
  start(): Promise<void>;
  stop(): void;
  readonly running: boolean;
  /** Bridge from the x402-settle-seam ledger → source="seam" edges. */
  seedFromSeam(entries: SeamSettleEntry[]): Promise<number>;
  /**
   * Funding pass — separate phase, never blocks edges (landmine).
   * For each payer: earliest inbound Transfer@USDC before its first
   * observed payment block → insertFirst (first-funder-only) +
   * public-source classification.
   */
  fundingPass(payers: string[]): Promise<number>;
}

export function createForensicsIndexer(
  deps: ForensicsIndexerDeps,
): ForensicsIndexer {
  const {
    client,
    stores,
    chain,
    usdcAddress = USDC_ARC,
    startBlock,
    lookbackBlocks = 100_000n,
    batchBlocks = 10_000n,
    reorgBlocks = 64n,
    pollMs = 15_000,
    publicSources = new Map(),
    fundingLookbackBlocks = 200_000n,
    log = logger,
  } = deps;

  let stopped = true; // timer state — blocks liveTick, not explicit sync()
  let syncHalt = false; // interrupt flag for in-flight loops (set by stop())
  let timer: ReturnType<typeof setInterval> | null = null;

  const fetchRange = async (from: bigint, to: bigint) => {
    try {
      return await client.getLogs({
        address: usdcAddress,
        topics: [[TRANSFER_TOPIC, AUTH_USED_TOPIC]],
        fromBlock: from,
        toBlock: to,
      });
    } catch (e) {
      log.warn("[ForensicsIndexer] getLogs range failed — cursor NOT advanced", {
        chain,
        from: String(from),
        to: String(to),
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  };

  async function sync(
    opts: { reorgWindow?: bigint } = {},
  ): Promise<bigint | null> {
    const reorg = opts.reorgWindow ?? 0n;
    let tip: bigint;
    try {
      tip = await client.getBlockNumber();
    } catch (e) {
      log.warn("[ForensicsIndexer] getBlockNumber failed", {
        chain,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
    syncHalt = false; // fresh explicit run — clear any prior interrupt
    const cur = await stores.cursor.get(chain);
    const floor =
      startBlock ?? (tip > lookbackBlocks ? tip - lookbackBlocks : 0n);
    let from =
      cur === null
        ? floor
        : cur + 1n - reorg > floor
          ? cur + 1n - reorg
          : floor;
    let last: bigint | null = cur;
    while (from <= tip && !syncHalt) {
      const to = from + batchBlocks - 1n < tip ? from + batchBlocks - 1n : tip;
      const logs = await fetchRange(from, to);
      if (logs === null) break; // retention/RPC hole — retry next tick
      const edges = extractSettleEdges(logs, chain, usdcAddress);
      const inserted = await stores.edges.appendBatch(edges);
      // batch-write THEN cursor — crash between them re-scans + dedups.
      await stores.cursor.set(chain, to);
      last = to;
      if (inserted > 0 || to === tip) {
        log.info("[ForensicsIndexer] indexed", {
          chain,
          to: String(to),
          tip: String(tip),
          lag: String(tip - to),
          edges: inserted,
        });
      }
      from = to + 1n;
    }
    return last;
  }

  async function fundingPass(payers: string[]): Promise<number> {
    syncHalt = false;
    let written = 0;
    for (const raw of payers) {
      if (syncHalt) break;
      const payer = raw.toLowerCase();
      const edges = await stores.edges.listByPayer(chain, payer);
      const firstBlock = edges.reduce(
        (m, e) => (e.blockNumber > 0n && (m === 0n || e.blockNumber < m) ? e.blockNumber : m),
        0n,
      );
      if (firstBlock === 0n) continue; // seam-only edges — no chain window
      const fromB =
        firstBlock - fundingLookbackBlocks > 0n
          ? firstBlock - fundingLookbackBlocks
          : 0n;
      // inbound Transfer@USDC to `payer` before its first payment —
      // chunked by batchBlocks (spike limit); earliest wins.
      let best: { funder: string; txHash: string; blockNumber: bigint } | null =
        null;
      for (let f = fromB; f < firstBlock && !syncHalt; f += batchBlocks) {
        const t =
          f + batchBlocks - 1n < firstBlock - 1n
            ? f + batchBlocks - 1n
            : firstBlock - 1n;
        let logs: ForensicsLog[];
        try {
          logs = await client.getLogs({
            address: usdcAddress,
            topics: [TRANSFER_TOPIC, null, pad32(payer)],
            fromBlock: f,
            toBlock: t,
          });
        } catch (e) {
          log.warn("[ForensicsIndexer] funding getLogs failed", {
            chain,
            payer,
            error: e instanceof Error ? e.message : String(e),
          });
          break;
        }
        for (const l of logs) {
          if (l.blockNumber == null || !l.transactionHash) continue;
          if (best === null || l.blockNumber < best.blockNumber) {
            best = {
              funder: topicAddr(l.topics[1]),
              txHash: l.transactionHash,
              blockNumber: l.blockNumber,
            };
          }
        }
      }
      if (best === null) continue;
      const kind = publicSources.get(best.funder) ?? null;
      const row = await stores.funding.insertFirst({
        chain,
        funded: payer,
        funder: best.funder,
        txHash: best.txHash,
        blockNumber: best.blockNumber,
        isPublicSource: kind !== null,
        sourceKind: kind,
      });
      if (row) written++;
    }
    return written;
  }

  const indexer: ForensicsIndexer = {
    sync,
    liveTick: () => sync({ reorgWindow: reorgBlocks }),
    seedFromSeam: (entries) =>
      stores.edges.appendBatch(seamEntriesToEdges(entries, chain)),
    fundingPass,
    async start() {
      if (!stopped) return;
      stopped = false;
      await sync(); // backfill first
      if (stopped) return;
      timer = setInterval(() => {
        void indexer.liveTick();
      }, pollMs);
      log.info("[ForensicsIndexer] started", { chain, pollMs });
    },
    stop() {
      stopped = true;
      syncHalt = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      log.info("[ForensicsIndexer] stopped", { chain });
    },
    get running() {
      return !stopped;
    },
  };
  return indexer;
}

// ─── env-driven singleton (base-event-indexer pattern) ─────────────

const CHAIN_RPC: Record<string, { env: string; def: string }> = {
  "5042": { env: "ARC_MAINNET_RPC_URL", def: "https://rpc.mainnet.arc.io" },
  "5042002": {
    env: "ARC_RPC_URL",
    def: "https://rpc.blockdaemon.testnet.arc.network",
  },
};

function parsePublicSources(): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (process.env.FORENSICS_PUBLIC_SOURCES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [addr, kind] = part.split(":");
    if (addr && kind) m.set(addr.toLowerCase(), kind.trim());
  }
  return m;
}

let runners: ForensicsIndexer[] | null = null;

/**
 * Start per-chain indexers against `getDatabase().forensics`.
 * FORENSICS_ENABLED=false → skip. DATABASE_ENABLED=off (no PG handle)
 * → warn + no-op (AC: honest, not silent in-memory swallow).
 */
export function startForensicsIndexer(): void {
  if (process.env.FORENSICS_ENABLED === "false") {
    logger.info("[ForensicsIndexer] Skipped — FORENSICS_ENABLED=false");
    return;
  }
  const db = getDatabase();
  if (!db.db) {
    logger.warn(
      "[ForensicsIndexer] Skipped — DATABASE_ENABLED=off (no persistence; honest no-op)",
    );
    return;
  }
  if (runners) {
    logger.info("[ForensicsIndexer] Already running");
    return;
  }
  const chains = (process.env.FORENSICS_CHAINS ?? "5042,5042002")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const batchBlocks = BigInt(process.env.FORENSICS_BATCH_BLOCKS ?? "10000");
  const reorgBlocks = BigInt(process.env.FORENSICS_REORG_BLOCKS ?? "64");
  const pollMs = Number(process.env.FORENSICS_POLL_MS ?? "15000");
  const lookback = BigInt(process.env.FORENSICS_LOOKBACK_BLOCKS ?? "100000");
  const fundingLookback = BigInt(
    process.env.FORENSICS_FUNDING_LOOKBACK ?? "200000",
  );
  const publicSources = parsePublicSources();
  const explicitStart = process.env.FORENSICS_START_BLOCK
    ? BigInt(process.env.FORENSICS_START_BLOCK)
    : undefined;

  runners = [];
  for (const chain of chains) {
    const rpcCfg = CHAIN_RPC[chain];
    if (!rpcCfg) {
      logger.warn("[ForensicsIndexer] unknown chain — no RPC mapping", {
        chain,
      });
      continue;
    }
    const rpcUrl = process.env[rpcCfg.env] ?? rpcCfg.def;
    const client = createPublicClient({ transport: http(rpcUrl) });
    const indexer = createForensicsIndexer({
      client: {
        getBlockNumber: () => client.getBlockNumber(),
        // translate the raw-topics interface to viem's events/args API:
        // [[T,A]] → OR of both events (sync); [T,null,to] → Transfer+args
        getLogs: (args) => {
          const [t0, , t2] = args.topics;
          const base = {
            address: args.address as Address,
            fromBlock: args.fromBlock,
            toBlock: args.toBlock,
            strict: true as const,
          };
          if (Array.isArray(t0)) {
            return client.getLogs({
              ...base,
              events: [TRANSFER_EVENT, AUTH_USED_EVENT],
            }) as unknown as Promise<ForensicsLog[]>;
          }
          if (typeof t2 === "string") {
            return client.getLogs({
              ...base,
              event: TRANSFER_EVENT,
              args: { to: `0x${t2.slice(-40)}` as Address },
            }) as unknown as Promise<ForensicsLog[]>;
          }
          return client.getLogs({
            ...base,
            event: TRANSFER_EVENT,
          }) as unknown as Promise<ForensicsLog[]>;
        },
      },
      stores: db.forensics,
      chain,
      // undefined → resolved inside sync() as tip − lookback (deep
      // backfill is impossible on the short-retention RPC anyway).
      startBlock: explicitStart,
      lookbackBlocks: lookback,
      batchBlocks,
      reorgBlocks,
      pollMs,
      publicSources,
      fundingLookbackBlocks: fundingLookback,
    });
    runners.push(indexer);
    void indexer.start();
  }
}

export function stopForensicsIndexer(): void {
  if (runners) {
    for (const r of runners) r.stop();
    runners = null;
  }
}

/** Test hook — drop singleton state. */
export function resetForensicsIndexerForTests(): void {
  stopForensicsIndexer();
}
