/**
 * SLICE-197-04: passport owner indexer — Transfer logs → passportOwner.
 * Fake log source (viem encodeEventLog); exercises backfill, monotonic
 * owner updates, resume via watermark, and replay idempotency.
 */
import { numberToHex, padHex, toEventSelector } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runPassportIndexer,
  type RawLog,
} from "../src/server/lib/bounties/indexer";
import {
  getPassportOwner,
  listPassportsByOwner,
  maxPassportOwnerBlock,
  resetBountyStoreForTesting,
  useMemoryBountyStoreForTesting,
} from "../src/server/lib/bounties/store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ARC_TESTNET, ERC8183_ABI } from "@agentbadge/circle-payments";

const REG = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const A = "0x00000000000000000000000000000000000000aA" as const;
const B = "0x00000000000000000000000000000000000000bB" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

function transferLog(
  from: `0x${string}`,
  to: `0x${string}`,
  tokenId: bigint,
  blockNumber: bigint,
  logIndex = 0,
): RawLog {
  // Topics built manually — indexed args only (viem has no
  // encodeEventLog in this version).
  const topics = [
    toEventSelector("Transfer(address,address,uint256)"),
    padHex(from.toLowerCase() as `0x${string}`, { size: 32 }),
    padHex(to.toLowerCase() as `0x${string}`, { size: 32 }),
    numberToHex(tokenId, { size: 32 }),
  ];
  return {
    address: REG,
    topics,
    // All Transfer args are indexed → data is empty.
    data: "0x",
    blockNumber,
    blockHash: `0x${"ab".repeat(32)}`,
    transactionHash: `0x${"cd".repeat(32)}`,
    logIndex,
  };
}

function fakeNet(): VenueNetwork {
  return {
    name: "testnet",
    chain: ARC_TESTNET,
    agenticCommerce: REG,
    identityRegistry: REG,
    reputationRegistry: REG,
    memo: REG,
    variant: "circle",
    abi: ERC8183_ABI,
    explorerTx: (h) => h,
    explorerAddr: (a) => a,
  };
}

function fakeHead(v: bigint) {
  return () => Promise.resolve(v);
}

function fakeHash(
  v: `0x${string}` = `0x${"ab".repeat(32)}`,
): () => Promise<`0x${string}` | null> {
  return () => Promise.resolve(v);
}

beforeEach(() => {
  useMemoryBountyStoreForTesting();
});

afterEach(() => {
  resetBountyStoreForTesting();
});

describe("runPassportIndexer", () => {
  it("backfill: mint + re-transfer set latest owner", async () => {
    const logs = [
      transferLog(ZERO, A, 5n, 100n, 0),
      transferLog(A, B, 5n, 150n, 0),
    ];
    const run = await runPassportIndexer({
      network: fakeNet,
      getLogs: (_a, _f, _t) => Promise.resolve(logs),
      getHead: fakeHead(200n),
      getBlockHash: fakeHash(),
    });

    expect(run.transfers).toBe(2);
    expect(getPassportOwner("5")?.owner).toBe(B.toLowerCase());
    expect(listPassportsByOwner(B)).toHaveLength(1);
    expect(listPassportsByOwner(A)).toHaveLength(0);
    expect(maxPassportOwnerBlock()).toBe(150);
  });

  it("monotonic guard: replayed older Transfer never regresses owner", async () => {
    await runPassportIndexer({
      network: fakeNet,
      getLogs: () =>
        Promise.resolve([
          transferLog(A, B, 7n, 150n, 0),
          transferLog(B, A, 7n, 140n, 0),
        ]),
      getHead: fakeHead(200n),
      getBlockHash: fakeHash(),
    });
    expect(getPassportOwner("7")?.owner).toBe(B.toLowerCase());
  });

  it("resume: second run starts after stored watermark", async () => {
    const ranges: [bigint, bigint][] = [];
    const getLogs = (_a: `0x${string}`, f: bigint, t: bigint) => {
      ranges.push([f, t]);
      return Promise.resolve([]);
    };
    await runPassportIndexer({
      network: fakeNet,
      getLogs,
      getHead: fakeHead(500n),
      getBlockHash: fakeHash(),
    });
    await runPassportIndexer({
      network: fakeNet,
      getLogs,
      getHead: fakeHead(600n),
      getBlockHash: fakeHash(),
    });
    // Run 2 covers only (500, 600] — watermark resume, no rescan.
    expect(ranges.at(-1)?.[0]).toBe(501n);
    expect(ranges.at(-1)?.[1]).toBe(600n);
  });

  it("reorg: stored hash mismatch rewinds the watermark", async () => {
    const head = { v: 300n };
    await runPassportIndexer({
      network: fakeNet,
      getLogs: () => Promise.resolve([]),
      getHead: () => Promise.resolve(head.v),
      getBlockHash: (): Promise<`0x${string}` | null> =>
        Promise.resolve(`0x${"ab".repeat(32)}` as `0x${string}`),
    });
    head.v = 400n;
    // Hash at watermark block changed → rewind lookback.
    const ranges: bigint[] = [];
    await runPassportIndexer({
      network: fakeNet,
      getLogs: (_a, f) => {
        ranges.push(f);
        return Promise.resolve([]);
      },
      getHead: () => Promise.resolve(head.v),
      getBlockHash: (n): Promise<`0x${string}` | null> =>
        Promise.resolve(
          n === 300n
            ? (`0x${"ff".repeat(32)}` as `0x${string}`)
            : (`0x${"ab".repeat(32)}` as `0x${string}`),
        ),
    });
    expect(ranges[0]).toBeLessThan(300n); // rewound, rescans tail
  });
});
