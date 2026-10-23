import { describe, expect, it } from "vitest";
import {
  InMemoryForensicsCursorStore,
  InMemoryForensicsEdgeStore,
  InMemoryForensicsFundingStore,
} from "@agentbadge/database";
import {
  AUTH_USED_TOPIC,
  createForensicsIndexer,
  extractSettleEdges,
  seamEntriesToEdges,
  TRANSFER_TOPIC,
  USDC_ARC,
  type ForensicsLog,
  type ForensicsLogsClient,
} from "../src/server/lib/forensics/indexer";

const CHAIN = "5042";
const PAYER = "0x00000000000000000000000000000000000000aa";
const SELLER = "0x00000000000000000000000000000000000000bb";
const EMITTER_MIRROR = "0xfffffffffffffffffffffffffffffffffffffffe";

const t32 = (addr: string) => `0x${"0".repeat(24)}${addr.slice(2)}`;
const hex = (n: bigint) => `0x${n.toString(16)}`;

const mkLog = (over: Partial<ForensicsLog>): ForensicsLog => ({
  address: USDC_ARC,
  topics: [TRANSFER_TOPIC],
  data: "0x",
  transactionHash: "0xtx",
  blockNumber: 100n,
  logIndex: 0,
  ...over,
});

const transfer = (tx: string, from: string, to: string, amt: bigint, bn = 100n, li = 0): ForensicsLog =>
  mkLog({
    topics: [TRANSFER_TOPIC, t32(from), t32(to)],
    data: hex(amt),
    transactionHash: tx,
    blockNumber: bn,
    logIndex: li,
  });

const authUsed = (tx: string, authorizer: string, bn = 100n, li = 5): ForensicsLog =>
  mkLog({
    topics: [AUTH_USED_TOPIC, t32(authorizer), t32("0xnonce00000000000000000000000000000000")],
    transactionHash: tx,
    blockNumber: bn,
    logIndex: li,
  });

const mkClient = (
  logs: ForensicsLog[],
  opts: { tip?: bigint; failRanges?: Array<[bigint, bigint]> } = {},
): ForensicsLogsClient & { calls: Array<{ from: bigint; to: bigint }> } => {
  const calls: Array<{ from: bigint; to: bigint }> = [];
  return {
    calls,
    getBlockNumber: async () => opts.tip ?? 200n,
    getLogs: async (args) => {
      calls.push({ from: args.fromBlock, to: args.toBlock });
      if (opts.failRanges?.some(([f, t]) => args.fromBlock <= t && args.toBlock >= f)) {
        throw new Error("pruned / range too large");
      }
      // topic[2] filter (funding pass) — emulate server-side filtering
      const toFilter = args.topics?.[2];
      return logs.filter(
        (l) =>
          l.blockNumber != null &&
          l.blockNumber >= args.fromBlock &&
          l.blockNumber <= args.toBlock &&
          (!toFilter || l.topics[2] === toFilter),
      );
    },
  };
};

const mkStores = () => ({
  edges: new InMemoryForensicsEdgeStore(),
  funding: new InMemoryForensicsFundingStore(),
  cursor: new InMemoryForensicsCursorStore(),
});

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("extractSettleEdges (pure)", () => {
  it("Transfer inside a settle tx → edge; generic Transfer ignored", () => {
    const logs = [
      transfer("0xsettle", PAYER, SELLER, 1_000_000n),
      authUsed("0xsettle", PAYER),
      transfer("0xplain", PAYER, SELLER, 2_000_000n), // no AuthUsed — not a settle
    ];
    const edges = extractSettleEdges(logs, CHAIN);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      chain: CHAIN,
      payer: PAYER,
      seller: SELLER,
      amountAtomic: 1_000_000n,
      txHash: "0xsettle",
      source: "chain",
    });
  });

  it("emitter-mirror logs (0xffff…fffe) are filtered by address", () => {
    const logs = [
      transfer("0xs", PAYER, SELLER, 5n),
      authUsed("0xs", PAYER),
      mkLog({
        address: EMITTER_MIRROR,
        topics: [TRANSFER_TOPIC, t32(PAYER), t32(SELLER)],
        transactionHash: "0xs",
        blockNumber: 100n,
      }),
    ];
    expect(extractSettleEdges(logs, CHAIN)).toHaveLength(1);
  });

  it("Gateway batch: 1 tx, 2 auths, 2 transfers → 2 edges (per-transfer payer)", () => {
    const p2 = "0x00000000000000000000000000000000000000cc";
    const logs = [
      transfer("0xbatch", PAYER, SELLER, 10n, 100n, 0),
      transfer("0xbatch", p2, SELLER, 20n, 100n, 1),
      authUsed("0xbatch", PAYER, 100n, 2),
      authUsed("0xbatch", p2, 100n, 3),
    ];
    const edges = extractSettleEdges(logs, CHAIN);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.payer).sort()).toEqual([PAYER, p2].sort());
  });
});

describe("indexer sync + cursor resume", () => {
  it("backfill writes edges + advances cursor to tip", async () => {
    const stores = mkStores();
    const client = mkClient(
      [transfer("0xa", PAYER, SELLER, 7n, 105n), authUsed("0xa", PAYER, 105n)],
      { tip: 150n },
    );
    const idx = createForensicsIndexer({
      client, stores, chain: CHAIN, startBlock: 100n, batchBlocks: 1000n, log: noopLog,
    });
    await idx.sync();
    expect(await stores.cursor.get(CHAIN)).toBe(150n);
    const edges = await stores.edges.listBySeller(CHAIN, SELLER);
    expect(edges).toHaveLength(1);
    expect(edges[0].amountAtomic).toBe(7n);
  });

  it("restart resumes from cursor — no duplicates (AC: resumable + idempotent)", async () => {
    const stores = mkStores();
    const logs = [
      transfer("0xa", PAYER, SELLER, 7n, 105n),
      authUsed("0xa", PAYER, 105n),
      transfer("0xb", PAYER, SELLER, 9n, 140n),
      authUsed("0xb", PAYER, 140n),
    ];
    const client = mkClient(logs, { tip: 150n });
    const mk = () =>
      createForensicsIndexer({
        client, stores, chain: CHAIN, startBlock: 100n, batchBlocks: 120n, log: noopLog,
      });
    await mk().sync(); // first run: batches 100-149? startBlock 100, batch 120 → 100→150 clip
    const count1 = (await stores.edges.listBySeller(CHAIN, SELLER)).length;
    expect(count1).toBe(2);
    await mk().sync(); // "restart" — cursor already at 150, nothing to do
    expect(await stores.edges.listBySeller(CHAIN, SELLER)).toHaveLength(2);
    // and re-running the SAME range is also dedup'd
    const rerun = createForensicsIndexer({
      client, stores, chain: CHAIN, startBlock: 100n, batchBlocks: 1000n, log: noopLog,
    });
    await rerun.sync({ reorgWindow: 200n }); // force re-scan of everything
    expect(await stores.edges.listBySeller(CHAIN, SELLER)).toHaveLength(2);
  });

  it("getLogs failure → cursor NOT advanced (honest retry, no silent skip)", async () => {
    const stores = mkStores();
    const client = mkClient([], { tip: 300n, failRanges: [[0n, 300n]] });
    const idx = createForensicsIndexer({
      client, stores, chain: CHAIN, startBlock: 100n, batchBlocks: 100n, log: noopLog,
    });
    const last = await idx.sync();
    expect(last).toBeNull();
    expect(await stores.cursor.get(CHAIN)).toBeNull();
  });

  it("liveTick re-scans reorg window — dups dedup'd, new edges land", async () => {
    const stores = mkStores();
    const logs = [transfer("0xa", PAYER, SELLER, 7n, 105n), authUsed("0xa", PAYER, 105n)];
    const client = mkClient(logs, { tip: 110n });
    const idx = createForensicsIndexer({
      client, stores, chain: CHAIN, startBlock: 100n, batchBlocks: 1000n, reorgBlocks: 10n, log: noopLog,
    });
    await idx.sync();
    // new block arrives with a new settle
    logs.push(transfer("0xb", PAYER, SELLER, 11n, 115n), authUsed("0xb", PAYER, 115n));
    (client as { getBlockNumber: () => Promise<bigint> }).getBlockNumber = async () => 115n;
    await idx.liveTick();
    expect(await stores.edges.listBySeller(CHAIN, SELLER)).toHaveLength(2);
    expect(await stores.cursor.get(CHAIN)).toBe(115n);
  });
});

describe("seedFromSeam", () => {
  it("seam entries → source=seam edges, chain-filtered, idempotent", async () => {
    const stores = mkStores();
    const idx = createForensicsIndexer({
      client: mkClient([]), stores, chain: CHAIN, startBlock: 0n, log: noopLog,
    });
    const entries = [
      { payer: PAYER, payTo: SELLER, amountUsd: "2.50", settleTx: "0xSEAM1", sourceChain: "eip155:5042", settledAt: 1_700_000_000_000 },
      { payer: PAYER, payTo: SELLER, amountUsd: "1.00", settleTx: "0xSEAM2", sourceChain: "eip155:84532" }, // other chain → skipped
    ];
    expect(await idx.seedFromSeam(entries)).toBe(1);
    expect(await idx.seedFromSeam(entries)).toBe(0); // dup no-op
    const edges = await stores.edges.listBySeller(CHAIN, SELLER);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("seam");
    expect(edges[0].amountAtomic).toBe(2_500_000n);
    expect(edges[0].txHash).toBe("0xseam1");
  });
});

describe("fundingPass", () => {
  it("earliest inbound Transfer before first payment → first-funder row", async () => {
    const stores = mkStores();
    // chain edge: payer first paid at block 150
    await stores.edges.append({
      chain: CHAIN, payer: PAYER, seller: SELLER, amountAtomic: 1n,
      txHash: "0xpay1", blockNumber: 150n, source: "chain", ts: 0n,
    });
    const funderPrivate = "0x00000000000000000000000000000000000000f1";
    const fundingLogs = [
      transfer("0xf1", funderPrivate, PAYER, 5_000_000n, 120n), // earlier — wins
      transfer("0xf2", "0x00000000000000000000000000000000000000f2", PAYER, 9n, 130n),
    ];
    const client = mkClient(fundingLogs, { tip: 200n });
    const idx = createForensicsIndexer({
      client, stores, chain: CHAIN, startBlock: 0n, batchBlocks: 1000n,
      fundingLookbackBlocks: 100n, log: noopLog,
    });
    expect(await idx.fundingPass([PAYER])).toBe(1);
    const row = await stores.funding.getFirst(CHAIN, PAYER);
    expect(row?.funder).toBe(funderPrivate);
    expect(row?.blockNumber).toBe(120n);
    expect(row?.isPublicSource).toBe(false);
    // second call → insertFirst no-op (already recorded)
    expect(await idx.fundingPass([PAYER])).toBe(0);
  });

  it("public-source funder is classified (custody_provider kills shared-funder false-positive)", async () => {
    const stores = mkStores();
    await stores.edges.append({
      chain: CHAIN, payer: PAYER, seller: SELLER, amountAtomic: 1n,
      txHash: "0xpay1", blockNumber: 150n, source: "chain", ts: 0n,
    });
    const exchange = "0x0000000000000000000000000000000000000e01";
    const client = mkClient([transfer("0xf", exchange, PAYER, 1n, 140n)], { tip: 200n });
    const idx = createForensicsIndexer({
      client, stores, chain: CHAIN, startBlock: 0n,
      publicSources: new Map([[exchange, "custody_provider"]]),
      fundingLookbackBlocks: 100n, log: noopLog,
    });
    await idx.fundingPass([PAYER]);
    const row = await stores.funding.getFirst(CHAIN, PAYER);
    expect(row?.isPublicSource).toBe(true);
    expect(row?.sourceKind).toBe("custody_provider");
  });
});

describe("seamEntriesToEdges (pure)", () => {
  it("amountAtomic wins over amountUsd; missing chain → current chain", () => {
    const edges = seamEntriesToEdges(
      [{ payer: PAYER, payTo: SELLER, amountAtomic: "42", amountUsd: "99.9", settleTx: "0xT" }],
      CHAIN,
    );
    expect(edges[0].amountAtomic).toBe(42n);
    expect(edges[0].source).toBe("seam");
  });
});
