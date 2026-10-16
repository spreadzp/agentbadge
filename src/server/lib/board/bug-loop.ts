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
import { boardStore } from "./store";
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

  // Audit C-3: the payout wallet is carried forward unsigned — verify it
  // against the append-only claim journal entry so a tampered lease row
  // cannot redirect funds.
  const claimEntry = st
    .listEntries(card.cardId)
    .find(
      (e) => e.kind === "claim" && e.attempt === bounty.jobAttempt,
    );
  const journaledWallet =
    typeof claimEntry?.payload?.payoutWallet === "string"
      ? claimEntry.payload.payoutWallet
      : undefined;
  if (
    journaledWallet !== undefined &&
    journaledWallet !== lease.payoutWallet.toLowerCase()
  ) {
    return fail(
      409,
      ErrorCodes.INVALID_STATE,
      "lease payout wallet diverges from the claim journal entry",
    );
  }

  // New attempt: same passport + payout carry the lease forward; the
  // provider binds onchain via the ops setProvider outbox row.
  const attempt = bounty.jobAttempt + 1;
  // Audit H-4: a chain-rejected attempt (bounty "failed") must walk the
  // lifecycle open→claimed→submitted rather than jumping straight to
  // submitted. A QA-failed attempt stays "submitted" (no chain verdict),
  // so there is nothing to replay — just bump the attempt.
  if (bounty.status === "failed") {
    const open = assertBountyTransition(bounty.status, "reopen");
    if (!open.ok) {
      return fail(
        409,
        ErrorCodes.INVALID_STATE,
        open.reason ?? "cannot reopen failed attempt",
      );
    }
    upsertBounty({ ...bounty, status: "open", jobAttempt: attempt });
    upsertBounty({ ...bounty, status: "claimed", jobAttempt: attempt });
    upsertBounty({ ...bounty, status: "submitted", jobAttempt: attempt });
  } else if (bounty.status === "submitted") {
    upsertBounty({ ...bounty, status: "submitted", jobAttempt: attempt });
  } else {
    return fail(
      409,
      ErrorCodes.INVALID_STATE,
      `fix resubmit expects failed|submitted bounty, got ${bounty.status}`,
    );
  }
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

export { sweepBoardFixLoop } from "./bug-sweep";
