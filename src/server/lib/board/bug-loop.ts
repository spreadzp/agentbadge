/**
 * SLICE-199-09 (EPIC-199): Bug column + fix-TTL loop over the 197-07
 * sweeper/reopen machinery.
 *
 *   enterBugCard     — QA-fail / review-reject put the card into bug
 *                      with fixDeadlineMs; journal kind=bug mirrors the
 *                      field so a reconciliation can verify the pair.
 *   resubmitBoardFix — the same lease holder resubmits inside the TTL:
 *                      a NEW job attempt (jobAttempt+1) starts, the
 *                      claim row carries the same passport+payout, and
 *                      a setProvider outbox row binds the payout wallet
 *                      onchain (ops signer, D-199-7).
 *   sweepBoardFixLoop— bug cards past fixDeadlineMs: attempt cap left
 *                      → reopen (bounty open, attempt+1, card todo);
 *                      cap exhausted → cancelled + claimRefund outbox.
 *                      `board:sweep:lock` incr-mutex makes the tick
 *                      safe for a second replica.
 */
import type { CacheProvider } from "@agentbadge/cache";

import { ErrorCodes, type ErrorCode } from "../error-codes";
import { tryGetCache } from "../cache";
import { assertBountyTransition } from "../bounties/lifecycle";
import {
  bountyStoreReady,
  claimKey,
  getBounty,
  getClaim,
  upsertBounty,
  upsertClaim,
  type BountyClaimRecord,
} from "../bounties/store";
import { boardStore, type BoardStoreBackend } from "./store";
import { assertColumnTransition } from "./columns";
import {
  boardIdempotencyKey,
  newEntryId,
  newOutboxId,
  type BoardCardRecord,
} from "./types";
import { BOARD_MAX_ATTEMPTS } from "./claim-sig";

export { BOARD_FIX_TTL_MS } from "./review";
export { BOARD_MAX_ATTEMPTS } from "./claim-sig";

/** Lock TTL for the fix-deadline sweeper tick. */
const SWEEP_LOCK_TTL_SEC = 60;

export interface BugLoopDeps {
  cache?: CacheProvider | null;
  now?: () => number;
  /** TG reminder via the 197-14 chat-subscription channel. */
  notify?: (card: BoardCardRecord, attempt: number) => void;
}

// ─── Bug entry ─────────────────────────────────────────────────

/**
 * Card → bug with a fix deadline. Shared writer for the QA-fail and
 * review-reject paths: card.fixDeadlineMs and the journal's
 * payload.fixDeadlineMs are written from the same value.
 */
export function enterBugCard(
  cardId: string,
  attempt: number,
  reasonCodes: string[],
  now: number,
  deadlineMs: number,
  deps: Pick<BugLoopDeps, "notify"> = {},
): void {
  const st = boardStore();
  st.patchCard(cardId, { column: "bug", fixDeadlineMs: deadlineMs });
  st.appendEntry({
    id: newEntryId(),
    cardId,
    attempt,
    seq: st.nextEntrySeq(cardId),
    kind: "bug",
    actor: "qa",
    atMs: now,
    payload: { reasonCodes, fixDeadlineMs: deadlineMs },
  });
  const card = st.getCard(cardId);
  if (card && deps.notify) deps.notify(card, attempt);
}

// ─── Fix resubmit (bug → testing) ──────────────────────────────

export interface FixResubmitRequest {
  cardId: string;
  passportId: string;
}

export type FixResubmitResult =
  | { ok: true; card: BoardCardRecord; attempt: number }
  | { ok: false; status: number; code: ErrorCode; message: string };

function fail(
  status: number,
  code: ErrorCode,
  message: string,
): FixResubmitResult {
  return { ok: false, status, code, message };
}

export async function resubmitBoardFix(
  req: FixResubmitRequest,
  deps: BugLoopDeps = {},
): Promise<FixResubmitResult> {
  await bountyStoreReady();
  const st = boardStore();
  await st.ready();
  const now = (deps.now ?? Date.now)();

  const card = st.getCard(req.cardId);
  if (!card) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown cardId");
  }
  const bounty = getBounty(card.bountyId);
  if (!bounty) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "card bounty missing");
  }
  const lease = getClaim(bounty.bountyId, bounty.jobAttempt);
  const col = assertColumnTransition({
    column: card.column,
    action: "fixResubmit",
    actor: { kind: "provider", passportId: req.passportId },
    leasePassportId: lease?.passportId,
    fixDeadlineMs: card.fixDeadlineMs,
    attemptsLeft: BOARD_MAX_ATTEMPTS() - bounty.jobAttempt,
    nowMs: now,
  });
  if (!col.ok) {
    const status =
      col.reason?.includes("lease-holding") ||
        col.reason?.includes("cannot")
        ? col.reason.includes("lease") ? 403 : 409
        : 409;
    return fail(status, ErrorCodes.INVALID_STATE, col.reason ?? "cannot resubmit");
  }
  if (!lease) {
    return fail(409, ErrorCodes.INVALID_STATE, "no lease for this attempt");
  }

  // New attempt: same passport + payout carry the lease forward; the
  // provider binds onchain via the ops setProvider outbox row.
  const attempt = bounty.jobAttempt + 1;
  upsertBounty({ ...bounty, status: "submitted", jobAttempt: attempt });
  const claim: BountyClaimRecord = {
    id: claimKey(bounty.bountyId, attempt),
    bountyId: bounty.bountyId,
    jobAttempt: attempt,
    passportId: lease.passportId,
    payoutWallet: lease.payoutWallet,
    state: "consumed",
    claimedAtMs: now,
    leaseUntilMs: lease.leaseUntilMs,
  };
  upsertClaim(claim);
  const patched = st.patchCard(card.cardId, {
    column: "testing",
    fixDeadlineMs: null,
  });
  st.enqueueOutbox({
    id: newOutboxId(),
    kind: "setProvider",
    cardId: card.cardId,
    jobAttempt: attempt,
    idempotencyKey: boardIdempotencyKey(card.cardId, attempt, "setProvider"),
    status: "pending",
    attempts: 0,
    payload: {
      passportId: lease.passportId,
      payoutWallet: lease.payoutWallet,
    },
    createdAt: new Date(now).toISOString(),
  });
  st.appendEntry({
    id: newEntryId(),
    cardId: card.cardId,
    attempt,
    seq: st.nextEntrySeq(card.cardId),
    kind: "submit",
    actor: req.passportId,
    atMs: now,
    payload: { fixResubmit: true },
  });
  return { ok: true, card: patched ?? card, attempt };
}

// ─── Fix-deadline sweeper ──────────────────────────────────────

export interface SweepResult {
  swept: string[];
  skipped?: boolean;
}

/**
 * One tick over the expired fix deadlines. Reopen keeps the card on
 * the board (todo, attempt+1); exhausting BOARD_MAX_ATTEMPTS cancels
 * the card and enqueues claimRefund so the client recovers the escrow.
 */
export async function sweepBoardFixLoop(
  deps: BugLoopDeps = {},
): Promise<SweepResult> {
  const st = boardStore();
  await st.ready();
  await bountyStoreReady();
  const now = (deps.now ?? Date.now)();
  const cache = deps.cache === null ? null : (deps.cache ?? tryGetCache());

  if (cache) {
    const n = await cache
      .incr("board:sweep:lock", SWEEP_LOCK_TTL_SEC)
      .catch(() => 0);
    if (n > 1) return { swept: [], skipped: true };
  }

  const swept: string[] = [];
  for (const card of st.listExpiredFix(now)) {
    const bounty = getBounty(card.bountyId);
    if (!bounty) continue;
    if (sweepCardExpired(st, card, bounty, now)) swept.push(card.cardId);
  }
  return { swept };
}

function sweepCardExpired(
  st: BoardStoreBackend,
  card: BoardCardRecord,
  bounty: NonNullable<ReturnType<typeof getBounty>>,
  now: number,
): boolean {
  const attempt = bounty.jobAttempt;
  if (attempt >= BOARD_MAX_ATTEMPTS()) {
    // Cap exhausted — cancel the card and refund the client escrow.
    upsertBounty({ ...bounty, status: "rejected" });
    st.patchCard(card.cardId, { column: "cancelled", fixDeadlineMs: null });
    st.enqueueOutbox({
      id: newOutboxId(),
      kind: "claimRefund",
      cardId: card.cardId,
      jobAttempt: attempt,
      idempotencyKey: boardIdempotencyKey(card.cardId, attempt, "claimRefund"),
      status: "pending",
      attempts: 0,
      payload: { jobId: bounty.onchainJobId, reason: "fix_deadline_exceeded" },
      createdAt: new Date(now).toISOString(),
    });
    st.appendEntry({
      id: newEntryId(),
      cardId: card.cardId,
      attempt,
      seq: st.nextEntrySeq(card.cardId),
      kind: "cancel",
      actor: "sweeper",
      atMs: now,
      payload: { reason: "fix_deadline_exceeded", attempt },
    });
    return true;
  }

  // Reopen: bounty open on a fresh attempt, card back to todo.
  const next = attempt + 1;
  const lc = assertBountyTransition(bounty.status, "reopen");
  upsertBounty({
    ...bounty,
    status: lc.ok ? "open" : "open",
    jobAttempt: next,
  });
  st.patchCard(card.cardId, {
    column: "todo",
    fixDeadlineMs: null,
    currentPassportId: "",
  });
  st.appendEntry({
    id: newEntryId(),
    cardId: card.cardId,
    attempt: next,
    seq: st.nextEntrySeq(card.cardId),
    kind: "reopen",
    actor: "sweeper",
    atMs: now,
    payload: { reason: "fix_deadline_expired", attempt: next },
  });
  return true;
}
