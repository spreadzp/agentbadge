/**
 * SLICE-199-13 (EPIC-199, D-199-7): board-aware claim-lease sweeper.
 *
 * The generic `sweepBountyLeases` is board-agnostic AND venue-agnostic —
 * its reject leg builds Circle/ACP-variant calldata and sends it inline
 * via sendAsRole. On the ref deploy that reverts, which would wedge a
 * claimed board card in "expired" with the alert loop firing. Board
 * cards therefore take their own expiry path here: every chain leg goes
 * through the ChainTxOutbox (dispatcher ships it with the ref ABI), the
 * card column returns to todo, and the journal records the reopen.
 *
 * Board jobs at claim-expiry are almost always Open onchain (provider
 * binding + funding ride inside the submit composite leg, which never
 * ran). A claimRefund row is still enqueued as a safety net — the
 * dispatcher preflights job.status and no-ops unless Funded.
 */
import {
  appendTransition,
  bountyStoreReady,
  getBounty,
  getClaim,
  putOutcome,
  upsertBounty,
  upsertClaim,
} from "../bounties/store";
import { boardStore } from "./store";
import {
  boardIdempotencyKey,
  newEntryId,
  newOutboxId,
} from "./types";
import { BOARD_MAX_ATTEMPTS } from "./claim-sig";

export interface BoardLeaseSweepResult {
  expired: number;
  reopened: number;
  cancelled: number;
  errors: string[];
}

/**
 * One tick over claimed board cards whose lease has run out. Mirrors
 * bug-sweep's reopen/cancel shape, but the trigger is the claim lease
 * (in_progress cards) rather than the fix deadline (bug cards).
 */
export async function sweepBoardClaimLeases(
  deps: { now?: () => number } = {},
): Promise<BoardLeaseSweepResult> {
  const st = boardStore();
  await st.ready();
  await bountyStoreReady();
  const now = (deps.now ?? Date.now)();
  const res: BoardLeaseSweepResult = {
    expired: 0, reopened: 0, cancelled: 0, errors: [],
  };

  for (const card of st.listCards({ column: "in_progress" })) {
    const bounty = getBounty(card.bountyId);
    if (!bounty || bounty.status !== "claimed") continue;
    const claim = getClaim(bounty.bountyId, bounty.jobAttempt);
    if (!claim || claim.state !== "open" || claim.leaseUntilMs > now) {
      continue;
    }

    try {
      const attempt = bounty.jobAttempt;
      const oldJobId = bounty.onchainJobId ?? null;

      // Off-chain tombstones first — claim/attempt are closed regardless
      // of how the chain leg settles (the outbox row owns the leg).
      claim.state = "expired";
      upsertClaim(claim);
      putOutcome({
        id: `${bounty.bountyId}:${attempt}`,
        bountyId: bounty.bountyId,
        jobAttempt: attempt,
        passportId: claim.passportId,
        verdict: "timeout",
        reasonCodes: ["lease_expired"],
      });
      appendTransition({
        id: `${bounty.bountyId}:${attempt}:expire:${now}`,
        bountyId: bounty.bountyId,
        actor: "sweeper",
        from: "claimed",
        to: "expired",
        atMs: now,
        payload: { cardId: card.cardId, oldJobId },
      });
      res.expired++;

      if (attempt >= BOARD_MAX_ATTEMPTS()) {
        // Cap exhausted — cancel the card, refund whatever was funded.
        upsertBounty({ ...bounty, status: "rejected" });
        st.patchCard(card.cardId, { column: "cancelled", fixDeadlineMs: null });
        if (oldJobId) {
          st.enqueueOutbox({
            id: newOutboxId(),
            kind: "claimRefund",
            cardId: card.cardId,
            jobAttempt: attempt,
            idempotencyKey: boardIdempotencyKey(card.cardId, attempt, "claimRefund"),
            status: "pending",
            attempts: 0,
            payload: { jobId: oldJobId, reason: "lease_expired_cap" },
            createdAt: new Date(now).toISOString(),
          });
        }
        st.appendEntry({
          id: newEntryId(),
          cardId: card.cardId,
          attempt,
          seq: st.nextEntrySeq(card.cardId),
          kind: "cancel",
          actor: "sweeper",
          atMs: now,
          payload: { reason: "lease_expired_cap", attempt },
        });
        res.cancelled++;
        continue;
      }

      const next = attempt + 1;
      // Safety leg for the edge where bind+fund landed but submit didn't
      // (bounty still "claimed" with a Funded job): dispatcher preflights
      // job.status and no-ops unless escrow is actually locked (Funded).
      if (oldJobId) {
        st.enqueueOutbox({
          id: newOutboxId(),
          kind: "claimRefund",
          cardId: card.cardId,
          jobAttempt: attempt,
          idempotencyKey: boardIdempotencyKey(card.cardId, attempt, "claimRefund"),
          status: "pending",
          attempts: 0,
          payload: { jobId: oldJobId, reason: "lease_expired" },
          createdAt: new Date(now).toISOString(),
        });
      }
      // Reopen: bounty open on a fresh attempt — onchainJobId is
      // attempt-scoped, so the stale id must not survive the bump.
      upsertBounty({
        ...bounty,
        status: "open",
        jobAttempt: next,
        onchainJobId: undefined,
      });
      st.enqueueOutbox({
        id: newOutboxId(),
        kind: "createJob",
        cardId: card.cardId,
        jobAttempt: next,
        idempotencyKey: boardIdempotencyKey(card.cardId, next, "createJob"),
        status: "pending",
        attempts: 0,
        payload: { bountyId: bounty.bountyId, provider: null },
        createdAt: new Date(now).toISOString(),
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
        payload: { reason: "lease_expired", attempt: next, oldJobId },
      });
      res.reopened++;
    } catch (e) {
      res.errors.push(`${card.cardId}: ${String(e).slice(0, 120)}`);
    }
  }
  return res;
}
