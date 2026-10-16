/**
 * SLICE-199-13 (EPIC-199): QA verdict entry — ops/worker marks a
 * testing card pass (→ review) or fail (→ bug via enterBugCard).
 * QA itself runs outside this process (arc-studio runner); this is
 * the trust boundary where its outcome enters the board.
 */
import { ErrorCodes, type ErrorCode } from "../error-codes";
import {
  bountyStoreReady,
  getBounty,
} from "../bounties/store";
import { boardStore } from "./store";
import { assertColumnTransition } from "./columns";
import { enterBugCard, BOARD_FIX_TTL_MS } from "./bug-loop";
import {
  newEntryId,
  type BoardCardRecord,
} from "./types";

export type BoardQaVerdict = "pass" | "fail";

export interface BoardQaRequest {
  cardId: string;
  verdict: BoardQaVerdict;
  reasonCodes?: string[];
  actor?: string;
}

export interface BoardQaDeps {
  now?: () => number;
  fixTtlMs?: number;
}

export type BoardQaResult =
  | { ok: true; card: BoardCardRecord }
  | { ok: false; status: number; code: ErrorCode; message: string };

function fail(status: number, code: ErrorCode, message: string): BoardQaResult {
  return { ok: false, status, code, message };
}

export async function recordBoardQaVerdict(
  req: BoardQaRequest,
  deps: BoardQaDeps = {},
): Promise<BoardQaResult> {
  const st = boardStore();
  await st.ready();
  await bountyStoreReady();
  const now = (deps.now ?? Date.now)();
  const actor = req.actor ?? "qa";

  const card = st.getCard(req.cardId);
  if (!card) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown cardId");
  }
  const bounty = getBounty(card.bountyId);
  if (!bounty) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "card bounty missing");
  }
  if (req.verdict !== "pass" && req.verdict !== "fail") {
    return fail(400, ErrorCodes.INVALID_INPUT, "verdict must be pass|fail");
  }

  if (req.verdict === "fail") {
    const col = assertColumnTransition({
      column: card.column,
      action: "qaFail",
      actor: { kind: "evaluator", passportId: actor },
      nowMs: now,
    });
    if (!col.ok) {
      return fail(409, ErrorCodes.INVALID_STATE, col.reason ?? "cannot qaFail");
    }
    const deadlineMs = now + (deps.fixTtlMs ?? BOARD_FIX_TTL_MS());
    enterBugCard(
      card.cardId,
      bounty.jobAttempt,
      req.reasonCodes ?? ["qa_fail"],
      now,
      deadlineMs,
    );
    const patched = st.getCard(card.cardId);
    return { ok: true, card: patched ?? card };
  }

  // pass: testing → review; bounty stays submitted until review verdict
  const col = assertColumnTransition({
    column: card.column,
    action: "qaPass",
    actor: { kind: "evaluator", passportId: actor },
    nowMs: now,
  });
  if (!col.ok) {
    return fail(409, ErrorCodes.INVALID_STATE, col.reason ?? "cannot qaPass");
  }
  // qaPass is not a lifecycle move — the bounty must still sit submitted
  // until reviewApprove fires "pass".
  if (bounty.status !== "submitted") {
    return fail(
      409,
      ErrorCodes.INVALID_STATE,
      `qaPass requires bounty submitted, got ${bounty.status}`,
    );
  }
  const patched = st.patchCard(card.cardId, { column: "review" });
  st.appendEntry({
    id: newEntryId(),
    cardId: card.cardId,
    attempt: bounty.jobAttempt,
    seq: st.nextEntrySeq(card.cardId),
    kind: "qa",
    actor,
    atMs: now,
    payload: { verdict: "pass", reasonCodes: req.reasonCodes ?? [] },
  });
  return { ok: true, card: patched ?? card };
}
