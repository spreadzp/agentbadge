/**
 * SLICE-199-08 (EPIC-199): reviewer role + EIP-191 verdict.
 *   - verdict valid only from a reviewer passport, != provider
 *   - approve → ops completeTx via ChainTxOutbox → Done + payout
 *   - reject → Bug with a fresh fix deadline (ops rejectTx via outbox)
 *   - signature bound to attempt — replay on a new attempt → 403
 *   - reviewer cannot act before QA-pass (card must be in review)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryCache } from "@agentbadge/cache";

import {
  boardReviewMessage,
  submitBoardReview,
} from "../src/server/lib/board/review";
import { boardIdempotencyKey, computeSpecHash, type BoardCardRecord } from "../src/server/lib/board/types";
import { boardStore } from "../src/server/lib/board/store";
import { useMemoryBoardStoreForTesting } from "../src/server/lib/board/json-store";
import {
  upsertBounty,
  upsertClaim,
  useMemoryBountyStoreForTesting,
  getBounty,
} from "../src/server/lib/bounties/store";

const NOW = 1_700_000_000_000;
const CHAIN_ID = 5042002;
const REVIEWER_WALLET = "0x1111000000000000000000000000000000000001";
const spec = "Fix lint — run eslint --fix on src/";

function makeCard(over: Partial<BoardCardRecord> = {}): BoardCardRecord {
  return {
    cardId: "card_1",
    bountyId: "bnt_1",
    title: "Fix lint",
    spec,
    specHash: computeSpecHash(spec),
    column: "review", // QA already passed
    currentPassportId: "ps_provider",
    createdAt: new Date(NOW).toISOString(),
    payload: {},
    ...over,
  };
}

function seed(cardOver: Partial<BoardCardRecord> = {}) {
  boardStore().createCard(makeCard(cardOver));
  upsertBounty({
    bountyId: "bnt_1",
    title: "Fix lint",
    brief: { criteria: [], deliverableType: "pr" },
    budgetUsdc: "100",
    status: "submitted",
    jobAttempt: 1,
    onchainJobId: "42",
    createdAt: new Date(NOW).toISOString(),
  });
  upsertClaim({
    id: "bnt_1:1",
    bountyId: "bnt_1",
    jobAttempt: 1,
    passportId: "ps_provider",
    payoutWallet: "0xabc00000000000000000000000000000000000aa",
    state: "consumed",
    claimedAtMs: NOW - 3_600_000,
    leaseUntilMs: NOW + 3_600_000,
  });
}

let cache: InMemoryCache;
function deps(extra = {}) {
  return {
    cache,
    verifyReviewSig: () => Promise.resolve(true),
    isReviewer: (p: string) => p === "ps_reviewer",
    network: () => ({ chain: { chainId: CHAIN_ID } }) as never,
    now: () => NOW,
    ...extra,
  };
}

function req(over = {}) {
  return {
    cardId: "card_1",
    reviewerPassportId: "ps_reviewer",
    reviewerWallet: REVIEWER_WALLET,
    verdict: "approve" as const,
    comment: "lgtm",
    reviewSig: "0xreview",
    sigExpiresAt: NOW + 60_000,
    ...over,
  };
}

beforeEach(() => {
  cache = new InMemoryCache();
  useMemoryBoardStoreForTesting();
  useMemoryBountyStoreForTesting();
  seed();
});

describe("submitBoardReview — role gates", () => {
  it("non-reviewer passport → 403", async () => {
    const r = await submitBoardReview(
      req({ reviewerPassportId: "ps_rand" }),
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("reviewer == provider → 403", async () => {
    const r = await submitBoardReview(
      req({ reviewerPassportId: "ps_provider" }),
      deps({ isReviewer: () => true }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("card not in review (before qaPass) → 409", async () => {
    boardStore().patchCard("card_1", { column: "testing" });
    const r = await submitBoardReview(req(), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});

describe("submitBoardReview — EIP-191", () => {
  it("canonical message binds chain/card/attempt/verdict/wallet/expiry", () => {
    expect(
      boardReviewMessage(
        CHAIN_ID, "card_1", 1, "approve", REVIEWER_WALLET, NOW + 60_000,
      ),
    ).toBe(
      `board-review:${CHAIN_ID}:card_1:1:approve:${REVIEWER_WALLET.toLowerCase()}:${NOW + 60_000}`,
    );
  });

  it("bad signature → 403", async () => {
    const r = await submitBoardReview(
      req(),
      deps({ verifyReviewSig: () => Promise.resolve(false) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("expired sigExpiresAt → 400", async () => {
    const r = await submitBoardReview(req({ sigExpiresAt: NOW - 1 }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("replay on a new attempt → 403 (attempt bound into message)", async () => {
    expect((await submitBoardReview(req(), deps())).ok).toBe(true);
    // Card returns to review for attempt 2 (createCard is insert-only —
    // patch the existing record back).
    boardStore().patchCard("card_1", { column: "review" });
    upsertBounty({
      bountyId: "bnt_1",
      title: "Fix lint",
      brief: { criteria: [], deliverableType: "pr" },
      budgetUsdc: "100",
      status: "submitted",
      jobAttempt: 2,
      onchainJobId: "43",
      createdAt: new Date(NOW).toISOString(),
    });
    // A fresh signature VERIFIES only over the attempt-1 message — on
    // attempt 2 the bound :2: segment makes verification fail → 403.
    const verify = (w: string, msg: string) =>
      Promise.resolve(
        msg ===
        boardReviewMessage(
          CHAIN_ID, "card_1", 1, "approve", w, NOW + 60_000,
        ),
      );
    const r = await submitBoardReview(
      req({ reviewSig: "0xreview-attempt2" }),
      deps({ verifyReviewSig: verify }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});

describe("submitBoardReview — effects", () => {
  it("approve → card done, bounty passed, completeTx in outbox", async () => {
    const r = await submitBoardReview(req(), deps());
    expect(r.ok).toBe(true);
    const st = boardStore();
    expect(st.getCard("card_1")?.column).toBe("done");
    expect(getBounty("bnt_1")?.status).toBe("passed");

    const outbox = st.listOutbox({ cardId: "card_1" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe("complete");
    expect(outbox[0].status).toBe("pending");
    expect(outbox[0].idempotencyKey).toBe(
      boardIdempotencyKey("card_1", 1, "complete"),
    );

    const entries = st.listEntries("card_1");
    expect(entries.at(-1)?.kind).toBe("review");
    expect(entries.at(-1)?.payload?.verdict).toBe("approve");
  });

  it("reject → card bug + fix deadline, bounty failed, rejectTx in outbox", async () => {
    const r = await submitBoardReview(req({ verdict: "reject" }), deps());
    expect(r.ok).toBe(true);
    const st = boardStore();
    const card = st.getCard("card_1");
    expect(card?.column).toBe("bug");
    expect(card?.fixDeadlineMs).toBeGreaterThan(NOW);
    expect(getBounty("bnt_1")?.status).toBe("failed");

    const outbox = st.listOutbox({ cardId: "card_1" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe("reject");
  });

  it("journal: review entry carries sigHash + reviewer", async () => {
    await submitBoardReview(req(), deps());
    const entry = boardStore().listEntries("card_1").at(-1);
    expect(entry?.actor).toBe("ps_reviewer");
    expect(entry?.payload?.sigHash).toBeDefined();
  });
});
