/**
 * SLICE-199-08 (EPIC-199): reviewer role + EIP-191 verdict.
 *
 * A reviewer passport (distinct tier, ≠ the card's provider) signs a
 * verdict over the board-review namespace:
 *   board-review:{chainId}:{cardId}:{attempt}:{verdict}:{wallet}:{exp}
 *
 *   approve → ops-signer complete(jobId, reason=keccak(verdictPayload))
 *     enqueued via ChainTxOutbox (D-199-7) → card done + payout
 *   reject  → ops rejectTx via outbox → card bug + fresh fix deadline
 *
 * The reviewer only ever signs a message — the ops-signer executes the
 * chain legs, so the reviewer never holds treasury keys. The signature
 * binds chainId + cardId + jobAttempt + verdict + wallet + expiry: a
 * captured verdict cannot be replayed on a later attempt, card, or
 * flipped verdict.
 */
import type { CacheProvider } from "@agentbadge/cache";
import { keccak256, toBytes, stringToHex } from "viem";

import { ErrorCodes, type ErrorCode } from "../error-codes";
import { tryGetCache } from "../cache";
import { resolveVenueNetwork, type VenueNetwork } from "../venue/chain";
import {
  assertBountyTransition,
  type BountyStatus,
} from "../bounties/lifecycle";
import {
  bountyStoreReady,
  getBounty,
  upsertBounty,
} from "../bounties/store";
import { boardStore } from "./store";
import { assertColumnTransition } from "./columns";
import { defaultVerifyPayoutSig } from "./claim-sig";
import {
  boardIdempotencyKey,
  newEntryId,
  newOutboxId,
  type BoardCardRecord,
} from "./types";

// ─── Config ────────────────────────────────────────────────────

/** Review signature freshness window. */
export const BOARD_REVIEW_SIG_TTL_MS = () =>
  Number(process.env.BOARD_REVIEW_SIG_TTL_MS ?? 600_000); // 10 min

/** Fix-resubmit TTL after a reject (Bug column timer, 199-09 sweeps). */
export const BOARD_FIX_TTL_MS = () =>
  Number(process.env.BOARD_FIX_TTL_MS ?? 24 * 60 * 60 * 1000); // 24h

export type ReviewVerdict = "approve" | "reject";

/**
 * Canonical EIP-191 message — bound to chain + card + attempt +
 * verdict + signer wallet + expiry.
 */
export function boardReviewMessage(
  chainId: number | bigint,
  cardId: string,
  attempt: number,
  verdict: ReviewVerdict,
  wallet: string,
  expiresAtMs: number,
): string {
  return (
    `board-review:${chainId}:${cardId}:${attempt}:${verdict}:` +
    `${wallet.toLowerCase()}:${expiresAtMs}`
  );
}

// ─── Deps ──────────────────────────────────────────────────────

export interface BoardReviewDeps {
  cache?: CacheProvider | null;
  network?: () => VenueNetwork;
  /** Reviewer-tier passport check (passport registry lookup). */
  isReviewer?: (passportId: string) => boolean;
  /** EIP-191 verify for the reviewer wallet over boardReviewMessage. */
  verifyReviewSig?: (
    wallet: string,
    message: string,
    signature: string,
  ) => Promise<boolean>;
  now?: () => number;
}

// ─── Review ────────────────────────────────────────────────────

export interface BoardReviewRequest {
  cardId: string;
  reviewerPassportId: string;
  /** Reviewer wallet that produced reviewSig. */
  reviewerWallet: string;
  verdict: ReviewVerdict;
  comment?: string;
  reviewSig: string;
  sigExpiresAt?: number;
}

export type BoardReviewResult =
  | { ok: true; card: BoardCardRecord; outboxId: string; to: "done" | "bug" }
  | { ok: false; status: number; code: ErrorCode; message: string };

function fail(
  status: number,
  code: ErrorCode,
  message: string,
): BoardReviewResult {
  return { ok: false, status, code, message };
}

export async function submitBoardReview(
  req: BoardReviewRequest,
  deps: BoardReviewDeps = {},
): Promise<BoardReviewResult> {
  await bountyStoreReady();
  const st = boardStore();
  await st.ready();
  const net = (deps.network ?? resolveVenueNetwork)();
  const now = (deps.now ?? Date.now)();
  const cache = deps.cache === null ? null : (deps.cache ?? tryGetCache());

  // ─── role gates ────────────────────────────────────────────
  const isReviewer = deps.isReviewer ?? (() => false);
  if (!req.reviewerPassportId || !isReviewer(req.reviewerPassportId)) {
    return fail(
      403,
      ErrorCodes.PASSPORT_TYPE_REQUIRED,
      "reviewer-tier passport required",
    );
  }

  const card = st.getCard(req.cardId);
  if (!card) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown cardId");
  }
  // Segregation of duties: the provider may not review its own work.
  if (card.currentPassportId === req.reviewerPassportId) {
    return fail(
      403,
      ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH,
      "reviewer must differ from the provider passport",
    );
  }

  const action =
    req.verdict === "approve" ? "reviewApprove" : "reviewReject";
  const col = assertColumnTransition({
    column: card.column,
    action,
    actor: { kind: "reviewer", passportId: req.reviewerPassportId },
  });
  if (!col.ok) {
    return fail(409, ErrorCodes.INVALID_STATE, col.reason ?? "cannot review");
  }

  const bounty = getBounty(card.bountyId);
  if (!bounty) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "card bounty missing");
  }

  // ─── signature ─────────────────────────────────────────────
  const expiresAt = req.sigExpiresAt;
  if (
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > BOARD_REVIEW_SIG_TTL_MS()
  ) {
    return fail(
      400,
      ErrorCodes.INVALID_INPUT,
      `sigExpiresAt must be within ${BOARD_REVIEW_SIG_TTL_MS()}ms`,
    );
  }

  const sigHash = keccak256(toBytes(req.reviewSig));
  const replayKey = `board:sig:${sigHash}`;
  if (cache) {
    const seen = await cache.get<string>(replayKey).catch(() => null);
    if (seen !== null) {
      return fail(
        409,
        ErrorCodes.BOUNTY_ALREADY_CLAIMED,
        "signature already used",
      );
    }
  }

  const verify =
    deps.verifyReviewSig ??
    ((w, m, s) => defaultVerifyPayoutSig(net, w, m, s));
  const sigOk = await verify(
    req.reviewerWallet,
    boardReviewMessage(
      net.chain.chainId,
      card.cardId,
      bounty.jobAttempt,
      req.verdict,
      req.reviewerWallet,
      expiresAt,
    ),
    req.reviewSig,
  );
  if (!sigOk) {
    return fail(
      403,
      ErrorCodes.WRONG_SIGNER,
      "reviewer signature verification failed",
    );
  }
  if (cache) {
    await cache
      .set(replayKey, req.cardId, {
        ttlSec: Math.ceil(BOARD_REVIEW_SIG_TTL_MS() / 1000),
        tags: ["board", "sig"],
      })
      .catch(() => undefined);
  }

  // ─── lifecycle + column move ───────────────────────────────
  const lcAction = req.verdict === "approve" ? "pass" : "fail";
  const lc = assertBountyTransition(bounty.status, lcAction);
  if (!lc.ok) {
    return fail(409, ErrorCodes.INVALID_STATE, lc.reason ?? "lifecycle");
  }
  const nextStatus: BountyStatus = lc.to!;

  const reasonHash = keccak256(
    stringToHex(
      `board-review:${card.cardId}:${bounty.jobAttempt}:${req.verdict}`,
    ),
  );
  const txKind = req.verdict === "approve" ? "complete" : "reject";
  const outbox = st.enqueueOutbox({
    id: newOutboxId(),
    kind: txKind,
    cardId: card.cardId,
    jobAttempt: bounty.jobAttempt,
    idempotencyKey: boardIdempotencyKey(
      card.cardId,
      bounty.jobAttempt,
      txKind,
    ),
    status: "pending",
    attempts: 0,
    payload: {
      jobId: bounty.onchainJobId,
      reasonHash,
      reviewerPassportId: req.reviewerPassportId,
      reviewerWallet: req.reviewerWallet.toLowerCase(),
    },
    createdAt: new Date(now).toISOString(),
  });

  upsertBounty({ ...bounty, status: nextStatus });
  const patch =
    req.verdict === "approve"
      ? { column: col.to }
      : { column: col.to, fixDeadlineMs: now + BOARD_FIX_TTL_MS() };
  const patched = st.patchCard(card.cardId, patch);
  st.appendEntry({
    id: newEntryId(),
    cardId: card.cardId,
    attempt: bounty.jobAttempt,
    seq: st.nextEntrySeq(card.cardId),
    kind: "review",
    actor: req.reviewerPassportId,
    atMs: now,
    payload: {
      verdict: req.verdict,
      comment: req.comment,
      sigHash,
      outboxId: outbox.id,
      reasonHash,
    },
  });

  return {
    ok: true,
    card: patched ?? card,
    outboxId: outbox.id,
    to: col.to! as "done" | "bug",
  };
}
