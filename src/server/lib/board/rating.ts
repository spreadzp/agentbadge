/**
 * SLICE-199-10 (EPIC-199, absorbs 197-13): board rating write.
 *
 * When a card reaches done (complete tx confirmed), the provider's
 * passport gets a reputation score mirrored to ERC-8004:
 *
 *   score = max(0, 5 − (attempt − 1))      (D-199-2)
 *   clean first attempt → 5, one bug-fix → 4 … 6+ attempts → 0
 *
 * ReputationWrite is the shared ledger for venue jobs and board
 * cards (sourceType distinguishes the channel, like tag1 in D7-152);
 * unique(sourceType, sourceId, jobAttempt) makes the write
 * idempotent — a retried complete can never double-post feedback.
 * The onchain leg rides ChainTxOutbox kind=giveFeedback (memo-wrapped,
 * evaluator EOA signs — providers never touch treasury keys).
 *
 * A provider passport with no identity-registry record gets an
 * honest ledger entry with status "skipped" — no onchain write, no
 * fabricated agentId.
 */
import type { CacheProvider } from "@agentbadge/cache";
import { keccak256, toBytes, type Hex } from "viem";

import { ErrorCodes, type ErrorCode } from "../error-codes";
import { tryGetCache } from "../cache";
import { bountyStoreReady, getBounty, getPassportOwner } from "../bounties/store";
import { boardStore } from "./store";
import {
  boardIdempotencyKey,
  newEntryId,
  newOutboxId,
  newReputationId,
} from "./types";

/** Score formula — floor 0 (D-199-2). */
export function boardScoreForAttempt(attempt: number): number {
  return Math.max(0, 5 - (attempt - 1));
}

/** Cache tag for the leaderboard snapshot invalidated on rating. */
export const BOARD_LEADERS_TAG = "leaders";

export interface BoardFeedbackArgs {
  cardId: string;
  bountyId: string;
  jobId?: string;
  attempt: number;
  score: number;
  agentId: bigint;
  completeTx?: string;
  memoTx?: string;
  deliverableHash?: string;
}

export interface BoardFeedback {
  agentId: bigint;
  value: bigint;
  decimals: number;
  tag1: string;
  tag2: string;
  feedbackURI: string;
  hash: Hex;
}

/**
 * Compose the giveFeedback payload. feedbackURI is a self-contained
 * data:application/json proof package — an explorer can read card,
 * attempt, score and both settlement txes straight from the chain.
 */
export function composeBoardFeedback(a: BoardFeedbackArgs): BoardFeedback {
  const payload = {
    schema: "agentbadge.board.v1",
    cardId: a.cardId,
    bountyId: a.bountyId,
    jobId: a.jobId ?? null,
    attempt: a.attempt,
    deliverableHash: a.deliverableHash ?? null,
    score: a.score,
    completeTx: a.completeTx ?? null,
    memoTx: a.memoTx ?? null,
  };
  const feedbackURI =
    `data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
  return {
    agentId: a.agentId,
    value: BigInt(a.score),
    decimals: 0,
    tag1: "bounty-board",
    tag2: "escrow-verdict", // verifyMethod objective: escrow settled
    feedbackURI,
    hash:
      a.deliverableHash && /^0x[0-9a-fA-F]{64}$/.test(a.deliverableHash)
        ? (a.deliverableHash as Hex)
        : keccak256(toBytes(JSON.stringify(payload))),
  };
}

export interface BoardRatingDeps {
  cache?: CacheProvider | null;
  now?: () => number;
}

export type BoardRatingResult =
  | {
      ok: true;
      recordId: string;
      score: number;
      skipped?: boolean;
      duplicate?: boolean;
      outboxId?: string;
    }
  | { ok: false; status: number; code: ErrorCode; message: string };

function fail(
  status: number,
  code: ErrorCode,
  message: string,
): BoardRatingResult {
  return { ok: false, status, code, message };
}

/**
 * Write the rating for a completed card. Idempotent via
 * unique(sourceType, sourceId, jobAttempt) — a repeated complete for
 * the same attempt returns {duplicate:true} without touching the
 * outbox or the journal.
 */
export async function writeBoardRating(
  req: {
    cardId: string;
    completeTxHash?: string;
    memoTx?: string;
    deliverableHash?: string;
  },
  deps: BoardRatingDeps = {},
): Promise<BoardRatingResult> {
  const st = boardStore();
  await st.ready();
  await bountyStoreReady();
  const now = (deps.now ?? Date.now)();
  const cache = deps.cache === null ? null : (deps.cache ?? tryGetCache());

  const card = st.getCard(req.cardId);
  if (!card) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown cardId");
  }
  const bounty = getBounty(card.bountyId);
  if (!bounty) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "card bounty missing");
  }
  const passportId = card.currentPassportId;
  if (!passportId) {
    return fail(409, ErrorCodes.INVALID_STATE, "no provider passport");
  }

  const attempt = bounty.jobAttempt;
  const existing = st.getReputation("board", card.cardId, attempt);
  if (existing) {
    return {
      ok: true,
      recordId: existing.id,
      score: existing.score,
      duplicate: true,
      skipped: existing.status === "skipped" ? true : undefined,
    };
  }

  const score = boardScoreForAttempt(attempt);
  // passportId is the uint256 agentId decimal string on the identity
  // registry (PassportOwnerRecord). No owner record → honest skip.
  const owner = getPassportOwner(passportId);
  const agentId = owner ? BigInt(passportId) : undefined;
  const fb = agentId
    ? composeBoardFeedback({
        cardId: card.cardId,
        bountyId: bounty.bountyId,
        jobId: bounty.onchainJobId,
        attempt,
        score,
        agentId,
        completeTx: req.completeTxHash,
        memoTx: req.memoTx,
        deliverableHash: req.deliverableHash,
      })
    : undefined;

  const rec = st.putReputation({
    id: newReputationId(),
    sourceType: "board",
    sourceId: card.cardId,
    jobAttempt: attempt,
    passportId,
    agentId: agentId?.toString(),
    score,
    status: agentId ? "pending" : "skipped",
    feedbackUri: fb?.feedbackURI,
    feedbackHash: fb?.hash,
    attempts: 0,
  });

  let outboxId: string | undefined;
  if (agentId && fb) {
    const outbox = st.enqueueOutbox({
      id: newOutboxId(),
      kind: "giveFeedback",
      cardId: card.cardId,
      jobAttempt: attempt,
      idempotencyKey: boardIdempotencyKey(
        card.cardId,
        attempt,
        "giveFeedback",
      ),
      status: "pending",
      attempts: 0,
      payload: {
        reputationId: rec.id,
        agentId: agentId.toString(),
        value: score,
        decimals: 0,
        tag1: fb.tag1,
        tag2: fb.tag2,
        feedbackURI: fb.feedbackURI,
        hash: fb.hash,
        completeTx: req.completeTxHash ?? null,
      },
      createdAt: new Date(now).toISOString(),
    });
    outboxId = outbox.id;
  }

  st.appendEntry({
    id: newEntryId(),
    cardId: card.cardId,
    attempt,
    seq: st.nextEntrySeq(card.cardId),
    kind: "rating",
    actor: passportId,
    atMs: now,
    payload: {
      score,
      agentId: agentId?.toString() ?? null,
      reputationId: rec.id,
      outboxId: outboxId ?? null,
      completeTx: req.completeTxHash ?? null,
    },
  });

  if (cache) {
    await cache.invalidateTag(BOARD_LEADERS_TAG).catch(() => 0);
  }
  return {
    ok: true,
    recordId: rec.id,
    score,
    skipped: agentId === undefined ? true : undefined,
    outboxId,
  };
}
