/**
 * SLICE-199-10 (EPIC-199, absorbs 197-13): rating write on complete —
 * score = max(0, 5−(attempt−1)) mirrored to ERC-8004 via a
 * memo-wrapped giveFeedback; ReputationWrite is the idempotent ledger
 * (unique sourceType+sourceId+jobAttempt), ChainTxOutbox carries the tx.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryCache } from "@agentbadge/cache";

import {
  boardScoreForAttempt,
  composeBoardFeedback,
  writeBoardRating,
} from "../src/server/lib/board/rating";
import {
  computeSpecHash,
  type BoardCardRecord,
} from "../src/server/lib/board/types";
import { boardStore } from "../src/server/lib/board/store";
import { useMemoryBoardStoreForTesting } from "../src/server/lib/board/json-store";
import {
  upsertBounty,
  upsertPassportOwner,
  useMemoryBountyStoreForTesting,
} from "../src/server/lib/bounties/store";
const NOW = 1_700_000_000_000;
const spec = "Fix lint — run eslint --fix on src/";

function seed(attempt = 1, passportId = "42") {
  const card: BoardCardRecord = {
    cardId: "card_1",
    bountyId: "bnt_1",
    title: "Fix lint",
    spec,
    specHash: computeSpecHash(spec),
    column: "done",
    currentPassportId: passportId,
    createdAt: new Date(NOW).toISOString(),
    payload: {},
  };
  boardStore().createCard(card);
  upsertBounty({
    bountyId: "bnt_1",
    title: "Fix lint",
    brief: { criteria: [], deliverableType: "pr" },
    budgetUsdc: "100",
    status: "passed",
    jobAttempt: attempt,
    onchainJobId: "42",
    createdAt: new Date(NOW).toISOString(),
  });
  return card;
}

let cache: InMemoryCache;
function deps(extra = {}) {
  return { cache, now: () => NOW, ...extra };
}

beforeEach(() => {
  cache = new InMemoryCache();
  useMemoryBoardStoreForTesting();
  useMemoryBountyStoreForTesting();
  upsertPassportOwner({
    passportId: "42",
    owner: "0xabc00000000000000000000000000000000000aa",
    blockNumber: 1,
  });
  seed();
});

describe("boardScoreForAttempt — formula", () => {
  it.each([
    [1, 5],
    [2, 4],
    [3, 3],
    [4, 2],
    [5, 1],
    [6, 0],
    [10, 0],
  ])("attempt %i → score %i", (attempt, score) => {
    expect(boardScoreForAttempt(attempt)).toBe(score);
  });
});

describe("composeBoardFeedback", () => {
  it("proof URI is a readable data:application/json package", () => {
    const f = composeBoardFeedback({
      cardId: "card_1",
      bountyId: "bnt_1",
      jobId: "42",
      attempt: 1,
      score: 5,
      agentId: 42n,
      completeTx: "0xdead",
      memoTx: "0xbeef",
      deliverableHash: "0x" + "a".repeat(64),
    });
    expect(f.value).toBe(5n);
    expect(f.decimals).toBe(0);
    expect(f.tag1).toBe("bounty-board");
    expect(f.tag2).toBe("escrow-verdict");
    const json = JSON.parse(
      Buffer.from(f.feedbackURI.split(",")[1], "base64").toString(),
    );
    expect(json.schema).toBe("agentbadge.board.v1");
    expect(json.cardId).toBe("card_1");
    expect(json.score).toBe(5);
    expect(json.completeTx).toBe("0xdead");
  });
});

describe("writeBoardRating", () => {
  it("complete → ReputationWrite pending + giveFeedback outbox + journal", async () => {
    const r = await writeBoardRating(
      { cardId: "card_1", completeTxHash: "0xdead" },
      deps(),
    );
    expect(r.ok).toBe(true);

    const st = boardStore();
    const rec = st.getReputation("board", "card_1", 1);
    expect(rec).toBeDefined();
    expect(rec?.status).toBe("pending");
    expect(rec?.score).toBe(5);
    expect(rec?.agentId).toBe("42");
    expect(rec?.feedbackUri).toContain("data:application/json");

    const outbox = st.listOutbox({ cardId: "card_1" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe("giveFeedback");
    expect(outbox[0].idempotencyKey).toBe("board:card_1:1:giveFeedback");

    const entry = st.listEntries("card_1").at(-1);
    expect(entry?.kind).toBe("rating");
    expect(entry?.payload?.score).toBe(5);
  });

  it("attempt 2 → score 4", async () => {
    boardStore().createCard({
      cardId: "card_2",
      bountyId: "bnt_2",
      title: "Fix",
      spec,
      specHash: computeSpecHash(spec),
      column: "done",
      currentPassportId: "42",
      createdAt: new Date(NOW).toISOString(),
      payload: {},
    });
    upsertBounty({
      bountyId: "bnt_2",
      title: "Fix",
      brief: { criteria: [], deliverableType: "pr" },
      budgetUsdc: "100",
      status: "passed",
      jobAttempt: 2,
      createdAt: new Date(NOW).toISOString(),
    });
    await writeBoardRating({ cardId: "card_2" }, deps());
    expect(boardStore().getReputation("board", "card_2", 2)?.score).toBe(4);
  });

  it("repeat complete → idempotent (no duplicate feedback/outbox)", async () => {
    expect((await writeBoardRating({ cardId: "card_1" }, deps())).ok).toBe(true);
    const r = await writeBoardRating({ cardId: "card_1" }, deps());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.duplicate).toBe(true);
    expect(boardStore().listOutbox({ cardId: "card_1" })).toHaveLength(1);
    expect(
      boardStore().listReputation({ passportId: "42" }),
    ).toHaveLength(1);
  });

  it("honest zero: provider without agentId → ledger-only skipped", async () => {
    const r = await writeBoardRating(
      { cardId: "card_1" },
      deps(),
    );
    expect(r.ok).toBe(true);
    // passportId "42" IS registered as agentId here — flip: unknown
    // passport has no owner record → skipped.
    boardStore().patchCard("card_1", {
      currentPassportId: "unregistered",
      column: "done",
    });
    boardStore().createCard({
      cardId: "card_3",
      bountyId: "bnt_3",
      title: "Fix",
      spec,
      specHash: computeSpecHash(spec),
      column: "done",
      currentPassportId: "unregistered",
      createdAt: new Date(NOW).toISOString(),
      payload: {},
    });
    upsertBounty({
      bountyId: "bnt_3",
      title: "Fix",
      brief: { criteria: [], deliverableType: "pr" },
      budgetUsdc: "100",
      status: "passed",
      jobAttempt: 1,
      createdAt: new Date(NOW).toISOString(),
    });
    const r2 = await writeBoardRating({ cardId: "card_3" }, deps());
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.skipped).toBe(true);
    const rec = boardStore().getReputation("board", "card_3", 1);
    expect(rec?.status).toBe("skipped");
    expect(rec?.agentId).toBeUndefined();
    expect(
      boardStore().listOutbox({ cardId: "card_3" }),
    ).toHaveLength(0);
  });

  it("board:leaders cache invalidated on rating write", async () => {
    await cache.set("board:leaders", ["stale"], {
      tags: ["board", "leaders"],
    });
    await writeBoardRating({ cardId: "card_1" }, deps());
    expect(await cache.get("board:leaders")).toBeNull();
  });
});
