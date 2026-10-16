/**
 * SLICE-199-11 (EPIC-199): board card creation (ops path).
 *
 * ops-tier caller creates a card + its backing bounty in one move;
 * the onchain createJob (provider=0x0, open escrow target) is
 * enqueued via ChainTxOutbox — never an inline send (D-199-7).
 */
import { ErrorCodes, type ErrorCode } from "../error-codes";
import { upsertBounty, bountyStoreReady } from "../bounties/store";
import { newBountyId } from "../bounties/json-store";
import { boardStore } from "./store";
import {
  boardIdempotencyKey,
  computeSpecHash,
  newCardId,
  newEntryId,
  newOutboxId,
  type BoardCardRecord,
} from "./types";

export interface BoardCreateRequest {
  title: string;
  spec: string;
  budgetUsdc?: string;
  createdByPassportId?: string;
}

export interface BoardCreateDeps {
  newCardId?: () => string;
  newBountyId?: () => string;
  now?: () => number;
}

export type BoardCreateResult =
  | { ok: true; card: BoardCardRecord }
  | { ok: false; status: number; code: ErrorCode; message: string };

export async function createBoardCard(
  req: BoardCreateRequest,
  deps: BoardCreateDeps = {},
): Promise<BoardCreateResult> {
  const st = boardStore();
  await st.ready();
  await bountyStoreReady();
  const now = (deps.now ?? Date.now)();

  if (!req.spec || !req.spec.trim()) {
    return {
      ok: false,
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "spec required",
    };
  }
  if (!req.title || req.title.length > 200) {
    return {
      ok: false,
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "title required (≤200 chars)",
    };
  }

  const cardId = (deps.newCardId ?? newCardId)();
  const bountyId = (deps.newBountyId ?? newBountyId)();
  const card: BoardCardRecord = {
    cardId,
    bountyId,
    title: req.title.trim(),
    spec: req.spec,
    specHash: computeSpecHash(req.spec),
    column: "todo",
    budgetUsdc: req.budgetUsdc,
    createdBy: req.createdByPassportId,
    createdAt: new Date(now).toISOString(),
    payload: {},
  };
  if (!st.createCard(card)) {
    return {
      ok: false,
      status: 409,
      code: ErrorCodes.INVALID_INPUT,
      message: "cardId or bountyId collision",
    };
  }
  upsertBounty({
    bountyId,
    title: card.title,
    brief: { criteria: [], deliverableType: "pr" },
    budgetUsdc: req.budgetUsdc ?? "0",
    status: "open",
    jobAttempt: 1,
    createdByPassportId: req.createdByPassportId,
    createdAt: card.createdAt,
  });
  st.enqueueOutbox({
    id: newOutboxId(),
    kind: "createJob",
    cardId,
    jobAttempt: 1,
    idempotencyKey: boardIdempotencyKey(cardId, 1, "createJob"),
    status: "pending",
    attempts: 0,
    payload: { bountyId, provider: null, budgetUsdc: req.budgetUsdc ?? null },
    createdAt: card.createdAt,
  });
  st.appendEntry({
    id: newEntryId(),
    cardId,
    attempt: 1,
    seq: st.nextEntrySeq(cardId),
    kind: "create",
    actor: req.createdByPassportId ?? "ops",
    atMs: now,
    payload: { specHash: card.specHash },
  });
  return { ok: true, card };
}
