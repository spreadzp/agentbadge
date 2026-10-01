/**
 * SLICE-152-5: venue indexer — chunk pagination, watermark resume,
 * idempotent re-runs, stats aggregation, store backend switch.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";

import {
  resetStoreForTesting,
  setVenueBackendForTesting,
  setVenueMeta,
  upsertJob,
  useMemoryStoreForTesting,
  getVenueMeta,
  getJob,
  listJobs,
} from "../src/server/lib/venue/store";
import {
  runVenueIndexer,
  venueStats,
  venueIndexerHealth,
  type RawLog,
  type VenueIndexerDeps,
} from "../src/server/lib/venue/indexer";
import type { VenueNetwork } from "../src/server/lib/venue/chain";

const NET: VenueNetwork = {
  name: "testnet",
  chain: { id: 999999, rpcUrl: "http://unused" } as VenueNetwork["chain"],
  agenticCommerce: "0x1000000000000000000000000000000000000001",
  identityRegistry: "0x5000000000000000000000000000000000000005",
  memo: "0x2000000000000000000000000000000000000002",
  reputationRegistry: "0x3000000000000000000000000000000000000003",
  abi: ERC8183_ACP_ABI,
  variant: "acp",
  explorerTx: (h) => `https://scan/tx/${h}`,
  explorerAddr: (a) => `https://scan/address/${a}`,
} as VenueNetwork;

const CLIENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROVIDER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EVALUATOR = "0xcccccccccccccccccccccccccccccccccccccccc";

function jobCreatedLog(block: number, jobId: number, txN = 0): RawLog {
  // viem 2.55: no encodeEventLog — compose topics + data manually.
  const topics = encodeEventTopics({
    abi: ERC8183_ACP_ABI,
    eventName: "JobCreated",
    args: {
      jobId: BigInt(jobId),
      client: CLIENT,
      evaluator: EVALUATOR,
    },
  });
  const data = encodeAbiParameters(
    [
      { name: "provider", type: "address" },
      { name: "hook", type: "address" },
      { name: "expiredAt", type: "uint256" },
    ],
    [PROVIDER, "0x0000000000000000000000000000000000000000", BigInt(999999999)],
  );
  return {
    address: NET.agenticCommerce,
    topics: [...topics] as `0x${string}`[],
    data,
    blockNumber: BigInt(block),
    blockHash: `0x${String(block).padStart(64, "0")}`,
    transactionHash: `0xtx${String(jobId).padStart(60, "0")}${txN}` as `0x${string}`,
    logIndex: 0,
  };
}

/** Fake log source — deterministic per-range logs + call tracking. */
function fakeDeps(logs: RawLog[], head: bigint): VenueIndexerDeps & {
  calls: { from: bigint; to: bigint }[];
} {
  const calls: { from: bigint; to: bigint }[] = [];
  return {
    calls,
    network: () => NET,
    getHead: async () => head,
    getBlockHash: async (n) => `0x${String(n).padStart(64, "0")}`,
    getLogs: async (address, from, to) => {
      calls.push({ from, to });
      if (address.toLowerCase() !== NET.agenticCommerce.toLowerCase()) return [];
      return logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
    },
    onchainJob: async (_id) => ({
      status: 1,
      budget: BigInt(10_000_000),
      client: CLIENT,
      provider: PROVIDER,
      evaluator: EVALUATOR,
      hook: "0x0000000000000000000000000000000000000000",
      expiredAt: BigInt(999999999),
    }),
  };
}

describe("SLICE-152-5 venue indexer", () => {
  beforeEach(() => {
    useMemoryStoreForTesting();
    process.env.ARC_INDEXER_CHUNK_BLOCKS = "100";
  });
  afterEach(() => {
    resetStoreForTesting();
    setVenueBackendForTesting(null);
    delete process.env.ARC_INDEXER_CHUNK_BLOCKS;
  });

  it("indexes JobCreated events into the store", async () => {
    const deps = fakeDeps([jobCreatedLog(5, 42)], 100n);
    const result = await runVenueIndexer(deps);
    expect(result.matched).toBe(1);
    expect(result.toBlock).toBe(100);

    const job = getJob("vj_idx_42");
    expect(job).toBeDefined();
    expect(job?.onchainJobId).toBe(42);
    expect(job?.client.toLowerCase()).toBe(CLIENT);
    expect(job?.provider?.toLowerCase()).toBe(PROVIDER);
    expect(job?.chainTxs.created).toMatch(/^0xtx/);
  });

  it("paginates getLogs in ARC_INDEXER_CHUNK_BLOCKS chunks", async () => {
    const deps = fakeDeps([], 250n);
    await runVenueIndexer(deps);
    // 1..250 with chunk=100 → [1-100],[101-200],[201-250]; 2 calls each (acp+memo)
    const acpCalls = deps.calls;
    expect(acpCalls.length).toBe(6); // 3 chunks × 2 contracts
    expect(acpCalls[0]).toEqual({ from: 1n, to: 100n });
    expect(acpCalls[2]).toEqual({ from: 101n, to: 200n });
    expect(acpCalls[4]).toEqual({ from: 201n, to: 250n });
  });

  it("resumes from stored watermark instead of block 0", async () => {
    const deps = fakeDeps([jobCreatedLog(50, 7)], 200n);
    await runVenueIndexer(deps);
    expect(getVenueMeta("indexer:testnet:watermark")).toBe(200);

    const deps2 = fakeDeps([], 300n);
    await runVenueIndexer(deps2);
    // Next run starts at watermark+1=201, not 1
    expect(deps2.calls[0].from).toBe(201n);
    expect(getVenueMeta("indexer:testnet:watermark")).toBe(300);
  });

  it("is idempotent — re-running the same range yields one record", async () => {
    const deps = fakeDeps([jobCreatedLog(5, 9)], 100n);
    await runVenueIndexer(deps);
    const first = getJob("vj_idx_9");
    // rewind watermark manually (simulates a re-scan of the same range)
    setVenueMeta("indexer:testnet:watermark", 0);
    await runVenueIndexer(deps);
    const second = getJob("vj_idx_9");
    expect(second?.jobId).toBe(first?.jobId);
    expect(listJobs().filter((j) => j.onchainJobId === 9)).toHaveLength(1);
  });

  it("links a local job by onchainJobId instead of duplicating", async () => {
    upsertJob({
      jobId: "vj_local_1",
      title: "mine",
      description: "",
      budgetUsdc: 5,
      status: "pending",
      client: CLIENT,
      evaluator: EVALUATOR,
      createdAt: new Date().toISOString(),
      chainTxs: {},
      onchainJobId: 77,
    });
    const deps = fakeDeps([jobCreatedLog(5, 77)], 100n);
    await runVenueIndexer(deps);
    const job = getJob("vj_local_1");
    expect(job?.status).toBe("open"); // enriched from getJob
    expect(job?.chainTxs.created).toMatch(/^0xtx/);
    expect(getJob("vj_idx_77")).toBeUndefined();
  });

  it("records indexer events with dedupeKey (idempotent feed)", async () => {
    const deps = fakeDeps([jobCreatedLog(5, 15)], 100n);
    await runVenueIndexer(deps);
    await runVenueIndexer(deps);
    // second run covers 101..100 = empty range, no new events
    const jobs = listJobs();
    expect(jobs.filter((j) => j.onchainJobId === 15)).toHaveLength(1);
  });

  it("venueStats aggregates jobs, volume, feedback, providers, offers", async () => {
    upsertJob({
      jobId: "j1",
      title: "a",
      description: "",
      budgetUsdc: 10,
      status: "completed",
      client: CLIENT,
      provider: PROVIDER,
      evaluator: EVALUATOR,
      createdAt: "2026-01-01T00:00:00Z",
      chainTxs: {},
      feedback: { status: "sent" },
    });
    upsertJob({
      jobId: "j2",
      title: "b",
      description: "",
      budgetUsdc: 2.5,
      status: "funded",
      client: CLIENT,
      provider: PROVIDER,
      evaluator: EVALUATOR,
      createdAt: "2026-01-02T00:00:00Z",
      chainTxs: {},
    });
    const stats = venueStats();
    expect(stats.jobsTotal).toBe(2);
    expect(stats.jobsByStatus.completed).toBe(1);
    expect(stats.jobsByStatus.funded).toBe(1);
    expect(stats.volumeUsdc).toBe(12.5);
    expect(stats.feedbackCount).toBe(1);
    expect(stats.providersActive).toBe(1);
    expect(stats.offersActive).toBe(0);
  });

  it("venueIndexerHealth reports watermark + lag + lastRun", async () => {
    const deps = fakeDeps([jobCreatedLog(5, 3)], 120n);
    await runVenueIndexer(deps);
    const health = await venueIndexerHealth({ ...deps, getHead: async () => 150n });
    expect(health.watermark).toBe(120);
    expect(health.head).toBe(150);
    expect(health.lag).toBe(30);
    expect(health.lastRun?.matched).toBe(1);
  });

  it("reorg: watermark hash mismatch rewinds REORG_LOOKBACK", async () => {
    const deps = fakeDeps([], 200n);
    await runVenueIndexer(deps);
    expect(getVenueMeta("indexer:testnet:watermark")).toBe(200);

    const stale = fakeDeps([], 250n);
    stale.getBlockHash = async (n) =>
      n === 200n ? ("0xdeadbeef" + "0".repeat(54) as `0x${string}`) : `0x${String(n).padStart(64, "0")}`;
    await runVenueIndexer(stale);
    // watermark rewound from 200 to 136, then advanced to 250
    expect(stale.calls[0].from).toBe(137n);
    expect(getVenueMeta("indexer:testnet:watermark")).toBe(250);
  });
});

describe("SLICE-152-5 store backend", () => {
  beforeEach(() => useMemoryStoreForTesting());
  afterEach(() => {
    resetStoreForTesting();
    setVenueBackendForTesting(null);
    delete process.env.ARC_VENUE_STORE;
  });

  it("json backend is the default (ARC_VENUE_STORE unset)", () => {
    // _backend is reset via useMemoryStoreForTesting → json
    upsertJob({
      jobId: "jb1",
      title: "x",
      description: "",
      budgetUsdc: 1,
      status: "open",
      client: CLIENT,
      evaluator: EVALUATOR,
      createdAt: new Date().toISOString(),
      chainTxs: {},
    });
    expect(getJob("jb1")?.status).toBe("open");
  });

  it("meta keys persist via json backend", () => {
    setVenueMeta("indexer:testnet:watermark", 555);
    expect(getVenueMeta("indexer:testnet:watermark")).toBe(555);
  });
});
