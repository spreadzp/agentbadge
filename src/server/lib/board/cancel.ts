/**
 * SLICE-199-11 (EPIC-199): ops cancel — any column → cancelled.
 * Refund of escrow, when an onchain job exists, is enqueued as
 * claimRefund for the ops signer (D-199-7).
 */
import { ErrorCodes, type ErrorCode } from "../error-codes";
import {
  bountyStoreReady,
  getBounty,
  upsertBounty,
} from "../bounties/store";
import { boardStore } from "./store";
import { assertColumnTransition } from "./columns";
import {
  boardIdempotencyKey,
  newEntryId,
  newOutboxId,
  type BoardCardRecord,
} from "./types";

export interface BoardCancelDeps {
  now?: () => number;
}

export type BoardCancelResult =
  | { ok: true; card: BoardCardRecord }
  | { ok: false; status: number; code: ErrorCode; message: string };

export async function cancelBoardCard(
  cardId: string,
  actor: string,
  deps: BoardCancelDeps = {},
): Promise<BoardCancelResult> {
  const st = boardStore();
  await st.ready();
  await bountyStoreReady();
  const now = (deps.now ?? Date.now)();

  const card = st.getCard(cardId);
  if (!card) {
    return {
      ok: false,
      status: 404,
      code: ErrorCodes.RESOURCE_NOT_FOUND,
      message: "unknown cardId",
    };
  }
  const col = assertColumnTransition({
    column: card.column,
    action: "cancel",
    actor: { kind: "ops", passportId: actor },
  });
  if (!col.ok) {
    return {
      ok: false,
      status: 409,
      code: ErrorCodes.INVALID_STATE,
      message: col.reason ?? "cannot cancel",
    };
  }
  const bounty = getBounty(card.bountyId);
  if (bounty) {
    upsertBounty({ ...bounty, status: "rejected" });
    if (bounty.onchainJobId) {
      st.enqueueOutbox({
        id: newOutboxId(),
        kind: "claimRefund",
        cardId: card.cardId,
        jobAttempt: bounty.jobAttempt,
        idempotencyKey: boardIdempotencyKey(
          card.cardId,
          bounty.jobAttempt,
          "claimRefund",
        ),
        status: "pending",
        attempts: 0,
        payload: { jobId: bounty.onchainJobId, reason: "ops_cancel" },
        createdAt: new Date(now).toISOString(),
      });
    }
  }
  const patched = st.patchCard(card.cardId, {
    column: "cancelled",
    fixDeadlineMs: null,
  });
  st.appendEntry({
    id: newEntryId(),
    cardId: card.cardId,
    attempt: bounty?.jobAttempt ?? 1,
    seq: st.nextEntrySeq(card.cardId),
    kind: "cancel",
    actor,
    atMs: now,
    payload: { reason: "ops_cancel" },
  });
  return { ok: true, card: patched ?? card };
}
