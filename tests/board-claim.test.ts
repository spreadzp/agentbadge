/**
 * SLICE-199-07 (EPIC-199, D-199-1): off-chain board claim — claim a card
 * with ZERO chain legs. The provider binds later when ops funds the job
 * (setProvider + fund in one ops-signer batch). Covered:
 *   - passport gate (403), double claim (409), cooldown (409)
 *   - claimlock incr-mutex + sig replay-set (cache), degraded when off
 *   - EIP-191 namespace board-claim:{chainId}:{cardId}:{attempt}:{wallet}:{exp}
 *   - no sendTx anywhere on the claim path, no ChainTxOutbox rows
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryCache } from "@agentbadge/cache";

import {
  boardClaimMessage,
  claimBoardCard,
  BOARD_CLAIM_SIG_TTL_MS,
} from "../src/server/lib/board/claim";
import {
  computeSpecHash,
  type BoardCardRecord,
} from "../src/server/lib/board/types";
import { boardStore } from "../src/server/lib/board/store";
import {
  useMemoryBoardStoreForTesting,
} from "../src/server/lib/board/json-store";
import {
  upsertBounty,
  upsertClaim,
  useMemoryBountyStoreForTesting,
} from "../src/server/lib/bounties/store";
import type { BountyRecord } from "../src/server/lib/bounties/types";

const NOW = 1_700_000_000_000;
const WALLET = "0xabc00000000000000000000000000000000000aa" as `0x${string}`;
const CHAIN_ID = 5042002;

const spec = "Fix lint — run eslint --fix on src/";

function makeCard(over: Partial<BoardCardRecord> = {}): BoardCardRecord {
  return {
    cardId: "card_1",
    bountyId: "bnt_1",
    title: "Fix lint",
    spec,
    specHash: computeSpecHash(spec),
    column: "todo",
    createdAt: new Date(NOW).toISOString(),
    payload: {},
    ...over,
  };
}

function makeBounty(over: Partial<BountyRecord> = {}): BountyRecord {
  return {
    bountyId: "bnt_1",
    title: "Fix lint",
    reward: "100",
    status: "open",
    jobAttempt: 1,
    createdAt: new Date(NOW).toISOString(),
    ...over,
  } as BountyRecord;
}

let cache: InMemoryCache;
const verifyOk = () => Promise.resolve(true);
const verifyNo = () => Promise.resolve(false);
const sendTxSpy = vi.fn();

function deps(extra = {}) {
  return {
    cache,
    verifyPayoutSig: verifyOk,
    network: () => ({ chain: { chainId: CHAIN_ID } }) as never,
    sendTx: sendTxSpy,
    now: () => NOW,
    ...extra,
  };
}

function req(over = {}) {
  return {
    cardId: "card_1",
    passportId: "ps_agent1",
    payoutWallet: WALLET,
    claimSig: "0xsig",
    sigExpiresAt: NOW + 60_000,
    ...over,
  };
}

beforeEach(() => {
  cache = new InMemoryCache();
  useMemoryBoardStoreForTesting();
  useMemoryBountyStoreForTesting();
  sendTxSpy.mockReset();
  boardStore().createCard(makeCard());
  upsertBounty(makeBounty());
});

describe("claimBoardCard — gates", () => {
  it("missing passport → 403", async () => {
    const r = await claimBoardCard(req({ passportId: "" }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("unknown card → 404", async () => {
    const r = await claimBoardCard(req({ cardId: "nope" }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("card not in todo → 409", async () => {
    const st = boardStore();
    st.patchCard("card_1", { column: "in_progress" });
    const r = await claimBoardCard(req(), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("double claim same attempt → 409", async () => {
    expect((await claimBoardCard(req(), deps())).ok).toBe(true);
    const r = await claimBoardCard(req({ passportId: "ps_other" }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("two concurrent claims → exactly one wins", async () => {
    const [a, b] = await Promise.all([
      claimBoardCard(req(), deps()),
      claimBoardCard(req({ passportId: "ps_other" }), deps()),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("cooldown: live lease on the same bounty → 409", async () => {
    // Bounty reopened to attempt 3 while ps_agent1 still holds an open
    // lease from attempt 2 — Q28 cooldown blocks the re-claim.
    upsertBounty(makeBounty({ jobAttempt: 3 }));
    upsertClaim({
      id: "bnt_1:2",
      bountyId: "bnt_1",
      jobAttempt: 2,
      passportId: "ps_agent1",
      payoutWallet: WALLET.toLowerCase(),
      state: "open",
      claimedAtMs: NOW - 60_000,
      leaseUntilMs: NOW + 60_000,
    });
    const r = await claimBoardCard(req(), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});

describe("claimBoardCard — EIP-191", () => {
  it("canonical message format", () => {
    expect(
      boardClaimMessage(CHAIN_ID, "card_1", 1, WALLET, NOW + 60_000),
    ).toBe(
      `board-claim:${CHAIN_ID}:card_1:1:${WALLET.toLowerCase()}:${NOW + 60_000}`,
    );
  });

  it("bad signature → 403", async () => {
    const r = await claimBoardCard(
      req(),
      deps({ verifyPayoutSig: verifyNo }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("expired sigExpiresAt → 400", async () => {
    const r = await claimBoardCard(req({ sigExpiresAt: NOW - 1 }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("sigExpiresAt beyond TTL window → 400", async () => {
    const r = await claimBoardCard(
      req({ sigExpiresAt: NOW + BOARD_CLAIM_SIG_TTL_MS() + 1 }),
      deps(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("missing sigExpiresAt → 400", async () => {
    const r = await claimBoardCard(req({ sigExpiresAt: undefined }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("replay: same signature twice → second is 409", async () => {
    expect((await claimBoardCard(req(), deps())).ok).toBe(true);
    // Simulate a fresh card the sig could plausibly target — but replay
    // set rejects the identical signature regardless of target.
    boardStore().createCard(
      makeCard({ cardId: "card_2", bountyId: "bnt_2" }),
    );
    upsertBounty(makeBounty({ bountyId: "bnt_2" }));
    const r = await claimBoardCard(req({ cardId: "card_2" }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("cross-attempt: message binds jobAttempt — sig for attempt 1 fails on attempt 2", async () => {
    upsertBounty(makeBounty({ jobAttempt: 2 }));
    // verifyPayoutSig checks the message contains :1: for attempt binding
    const verify = (w: string, msg: string) =>
      Promise.resolve(msg === boardClaimMessage(CHAIN_ID, "card_1", 1, w, NOW + 60_000));
    const r = await claimBoardCard(
      req({ sigExpiresAt: NOW + 60_000 }),
      deps({ verifyPayoutSig: verify }),
    );
    // attempt is 2 → message contains :2: → verifier returns false
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});

describe("claimBoardCard — zero-gas + persistence", () => {
  it("happy path: claimed, journal entry, no outbox, no sendTx", async () => {
    const r = await claimBoardCard(req(), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const st = boardStore();
    const card = st.getCard("card_1");
    expect(card?.column).toBe("in_progress");
    expect(card?.currentPassportId).toBe("ps_agent1");

    const entries = st.listEntries("card_1");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("claim");
    expect(entries[0].attempt).toBe(1);

    // Off-chain by definition: no outbox rows, no chain calls.
    expect(st.listOutbox()).toHaveLength(0);
    expect(sendTxSpy).not.toHaveBeenCalled();
    expect(r.claim.payoutWallet).toBe(WALLET.toLowerCase());
  });

  it("claim writes payoutWallet that ops later binds via setProvider", async () => {
    const r = await claimBoardCard(req(), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claim.payoutWallet).toBe(WALLET.toLowerCase());
  });

  it("cache disabled → degrade through store backstop (no claimlock)", async () => {
    const first = await claimBoardCard(req(), deps({ cache: null }));
    expect(first.ok).toBe(true);
    const second = await claimBoardCard(
      req({ passportId: "ps_other" }),
      deps({ cache: null }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it("attempt cap: jobAttempt > BOARD_MAX_ATTEMPTS → 409", async () => {
    upsertBounty(makeBounty({ jobAttempt: 5 }));
    const r = await claimBoardCard(req(), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});
