/**
 * SLICE-199-11 (EPIC-199): lease-holder submit — card in_progress →
 * testing. The onchain submit(jobId, deliverableHash) leg is enqueued
 * via ChainTxOutbox for the ops signer; the API responds before the
 * tx lands (async outbox, D-199-7).
 */
import { ErrorCodes, type ErrorCode } from "../error-codes";
import {
  bountyStoreReady,
  getBounty,
  getClaim,
  upsertBounty,
} from "../bounties/store";
import { assertBountyTransition } from "../bounties/lifecycle";
import { boardStore } from "./store";
import { assertColumnTransition } from "./columns";
import {
  boardIdempotencyKey,
  newEntryId,
  newOutboxId,
  type BoardCardRecord,
} from "./types";

export interface BoardSubmitRequest {
  cardId: string;
  passportId: string;
  /** bytes32 deliverable hash bound onchain. */
  deliverableHash: string;
  prUrl?: string;
  commitSha?: string;
}

export interface BoardSubmitDeps {
  now?: () => number;
}

export type BoardSubmitResult =
  | { ok: true; card: BoardCardRecord; outboxId: string }
  | { ok: false; status: number; code: ErrorCode; message: string };

function fail(
  status: number,
  code: ErrorCode,
  message: string,
): BoardSubmitResult {
  return { ok: false, status, code, message };
}

export async function submitBoardWork(
  req: BoardSubmitRequest,
  deps: BoardSubmitDeps = {},
): Promise<BoardSubmitResult> {
  const st = boardStore();
  await st.ready();
  await bountyStoreReady();
  const now = (deps.now ?? Date.now)();

  const card = st.getCard(req.cardId);
  if (!card) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown cardId");
  }
  const bounty = getBounty(card.bountyId);
  if (!bounty) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "card bounty missing");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(req.deliverableHash ?? "")) {
    return fail(
      400,
      ErrorCodes.INVALID_INPUT,
      "deliverableHash must be bytes32",
    );
  }

  const lease = getClaim(bounty.bountyId, bounty.jobAttempt);
  const col = assertColumnTransition({
    column: card.column,
    action: "submit",
    actor: { kind: "provider", passportId: req.passportId },
    leasePassportId: lease?.passportId,
    nowMs: now,
  });
  if (!col.ok) {
    const status = col.reason?.includes("lease-holding") ? 403 : 409;
    return fail(status, ErrorCodes.INVALID_STATE, col.reason ?? "cannot submit");
  }
  const lc = assertBountyTransition(bounty.status, "submit");
  if (!lc.ok) {
    return fail(409, ErrorCodes.INVALID_STATE, lc.reason ?? "lifecycle");
  }

  upsertBounty({ ...bounty, status: "submitted" });
  const outbox = st.enqueueOutbox({
    id: newOutboxId(),
    kind: "submit",
    cardId: card.cardId,
    jobAttempt: bounty.jobAttempt,
    idempotencyKey: boardIdempotencyKey(card.cardId, bounty.jobAttempt, "submit"),
    status: "pending",
    attempts: 0,
    payload: {
      jobId: bounty.onchainJobId,
      deliverableHash: req.deliverableHash,
      prUrl: req.prUrl ?? null,
      commitSha: req.commitSha ?? null,
      passportId: req.passportId,
    },
    createdAt: new Date(now).toISOString(),
  });
  const patched = st.patchCard(card.cardId, { column: "testing" });
  st.appendEntry({
    id: newEntryId(),
    cardId: card.cardId,
    attempt: bounty.jobAttempt,
    seq: st.nextEntrySeq(card.cardId),
    kind: "submit",
    actor: req.passportId,
    atMs: now,
    payload: {
      deliverableHash: req.deliverableHash,
      prUrl: req.prUrl ?? null,
      outboxId: outbox.id,
    },
  });
  return { ok: true, card: patched ?? card, outboxId: outbox.id };
}
