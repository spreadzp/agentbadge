/**
 * SLICE-199-09 (EPIC-199): Bug column + fix-TTL loop over the 197-07
 * sweeper/reopen path.
 *   - enterBugCard: card → bug + fixDeadlineMs, journal kind=bug
 *     (shared by QA-fail and review-reject; fields must agree)
 *   - resubmitBoardFix: same lease holder inside TTL → testing,
 *     jobAttempt+1, setProvider enqueued for the new job
 *   - sweepBoardFixLoop: expired fixDeadline → reopen → todo;
 *     attempt cap exhausted → cancelled + claimRefund outbox
 *   - board:sweep:lock — second concurrent run skips (multi-replica)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryCache } from "@agentbadge/cache";

import {
  enterBugCard,
  resubmitBoardFix,
  sweepBoardFixLoop,
  BOARD_FIX_TTL_MS,
  BOARD_MAX_ATTEMPTS,
} from "../src/server/lib/board/bug-loop";
import {
  computeSpecHash,
  type BoardCardRecord,
} from "../src/server/lib/board/types";
import { boardStore } from "../src/server/lib/board/store";
import { useMemoryBoardStoreForTesting } from "../src/server/lib/board/json-store";
import {
  getBounty,
  getClaim,
  upsertBounty,
  upsertClaim,
  useMemoryBountyStoreForTesting,
} from "../src/server/lib/bounties/store";
import type { BountyRecord } from "../src/server/lib/bounties/types";

const NOW = 1_700_000_000_000;
const spec = "Fix lint — run eslint --fix on src/";

function makeCard(over: Partial<BoardCardRecord> = {}): BoardCardRecord {
  return {
    cardId: "card_1",
    bountyId: "bnt_1",
    title: "Fix lint",
    spec,
    specHash: computeSpecHash(spec),
    column: "bug",
    currentPassportId: "ps_provider",
    fixDeadlineMs: NOW + BOARD_FIX_TTL_MS(),
    createdAt: new Date(NOW).toISOString(),
    payload: {},
    ...over,
  };
}

function makeBounty(over: Partial<BountyRecord> = {}): BountyRecord {
  return {
    bountyId: "bnt_1",
    title: "Fix lint",
    brief: { criteria: [], deliverableType: "pr" },
    budgetUsdc: "100",
    status: "failed",
    jobAttempt: 1,
    onchainJobId: "42",
    createdAt: new Date(NOW).toISOString(),
    ...over,
  };
}

function seed(over: Partial<BoardCardRecord> = {}, attempt = 1) {
  boardStore().createCard(makeCard(over));
  upsertBounty(makeBounty({ jobAttempt: attempt }));
  upsertClaim({
    id: `bnt_1:${attempt}`,
    bountyId: "bnt_1",
    jobAttempt: attempt,
    passportId: "ps_provider",
    payoutWallet: "0xabc00000000000000000000000000000000000aa",
    state: "open",
    claimedAtMs: NOW - 3_600_000,
    leaseUntilMs: NOW + 3_600_000,
  });
}

let cache: InMemoryCache;
const notifySpy = vi.fn();
function deps(extra = {}) {
  return {
    cache,
    notify: notifySpy,
    now: () => NOW,
    ...extra,
  };
}

beforeEach(() => {
  cache = new InMemoryCache();
  notifySpy.mockReset();
  useMemoryBoardStoreForTesting();
  useMemoryBountyStoreForTesting();
  seed();
});

describe("enterBugCard", () => {
  it("QA-fail → bug + fixDeadlineMs; journal kind=bug mirrors the field", () => {
    const deadline = NOW + BOARD_FIX_TTL_MS();
    enterBugCard("card_1", 1, ["qa-fail", "lint"], NOW, deadline, {
      notify: notifySpy,
    });
    const card = boardStore().getCard("card_1");
    expect(card?.column).toBe("bug");
    expect(card?.fixDeadlineMs).toBe(deadline);
    const entry = boardStore().listEntries("card_1").at(-1);
    expect(entry?.kind).toBe("bug");
    expect(entry?.payload?.fixDeadlineMs).toBe(deadline);
    expect(entry?.payload?.reasonCodes).toContain("qa-fail");
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });
});

describe("resubmitBoardFix", () => {
  it("lease holder inside TTL → testing + attempt+1 + setProvider outbox", async () => {
    const r = await resubmitBoardFix(
      { cardId: "card_1", passportId: "ps_provider" },
      deps(),
    );
    expect(r.ok).toBe(true);

    expect(getBounty("bnt_1")?.jobAttempt).toBe(2);
    expect(getBounty("bnt_1")?.status).toBe("submitted");
    expect(getClaim("bnt_1", 2)?.passportId).toBe("ps_provider");

    const card = boardStore().getCard("card_1");
    expect(card?.column).toBe("testing");
    expect(card?.fixDeadlineMs).toBeUndefined();

    const outbox = boardStore().listOutbox({ cardId: "card_1" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe("setProvider");
    expect(outbox[0].jobAttempt).toBe(2);

    const entry = boardStore().listEntries("card_1").at(-1);
    expect(entry?.kind).toBe("submit");
    expect(entry?.attempt).toBe(2);
  });

  it("non-lease passport → 403", async () => {
    const r = await resubmitBoardFix(
      { cardId: "card_1", passportId: "ps_rand" },
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("fix deadline elapsed → 409 (sweeper path takes over)", async () => {
    boardStore().patchCard("card_1", { fixDeadlineMs: NOW - 1 });
    const r = await resubmitBoardFix(
      { cardId: "card_1", passportId: "ps_provider" },
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("attempt cap exhausted → 409", async () => {
    upsertBounty(makeBounty({ jobAttempt: BOARD_MAX_ATTEMPTS() }));
    upsertClaim({
      id: `bnt_1:${BOARD_MAX_ATTEMPTS()}`,
      bountyId: "bnt_1",
      jobAttempt: BOARD_MAX_ATTEMPTS(),
      passportId: "ps_provider",
      payoutWallet: "0xabc00000000000000000000000000000000000aa",
      state: "open",
      claimedAtMs: NOW - 3_600_000,
      leaseUntilMs: NOW + 3_600_000,
    });
    const r = await resubmitBoardFix(
      { cardId: "card_1", passportId: "ps_provider" },
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});

describe("sweepBoardFixLoop", () => {
  it("alive fixDeadline → skip (sweeper waits)", async () => {
    const r = await sweepBoardFixLoop(deps());
    expect(r.swept).toHaveLength(0);
    expect(boardStore().getCard("card_1")?.column).toBe("bug");
  });

  it("expired fixDeadline → reopen: todo + attempt+1", async () => {
    const r = await sweepBoardFixLoop(deps({ now: () => NOW + BOARD_FIX_TTL_MS() + 1 }));
    expect(r.swept).toContain("card_1");
    const card = boardStore().getCard("card_1");
    expect(card?.column).toBe("todo");
    expect(card?.fixDeadlineMs).toBeUndefined();
    expect(getBounty("bnt_1")?.status).toBe("open");
    expect(getBounty("bnt_1")?.jobAttempt).toBe(2);
    const entry = boardStore().listEntries("card_1").at(-1);
    expect(entry?.kind).toBe("reopen");
  });

  it("cap exhausted → cancelled + claimRefund outbox", async () => {
    upsertBounty(makeBounty({ jobAttempt: BOARD_MAX_ATTEMPTS() }));
    const r = await sweepBoardFixLoop(deps({ now: () => NOW + BOARD_FIX_TTL_MS() + 1 }));
    expect(r.swept).toContain("card_1");
    expect(boardStore().getCard("card_1")?.column).toBe("cancelled");
    expect(getBounty("bnt_1")?.status).toBe("rejected");
    const outbox = boardStore().listOutbox({ cardId: "card_1" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe("claimRefund");
  });

  it("board:sweep:lock — second concurrent run skips", async () => {
    boardStore().patchCard("card_1", { fixDeadlineMs: NOW - 1 });
    const first = await sweepBoardFixLoop(deps());
    expect(first.skipped).not.toBe(true);
    // Lock still held (TTL 60s) — a replica tick within the window skips.
    useMemoryBoardStoreForTesting();
    useMemoryBountyStoreForTesting();
    seed({ fixDeadlineMs: NOW - 1 });
    const second = await sweepBoardFixLoop(deps());
    expect(second.skipped).toBe(true);
    expect(second.swept).toHaveLength(0);
  });
});
