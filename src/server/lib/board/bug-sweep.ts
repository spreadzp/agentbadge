/**
 * SLICE-199-09 (EPIC-199): bug-loop sweeper — split out of bug-loop.ts
 * for the 300-line cap. One tick over expired fix deadlines: reopen
 * (todo, attempt+1) while attempts remain; cancel + claimRefund once
 * the cap is exhausted. The incr-mutex fails closed so two replicas
 * never both sweep on a cache error (audit M-5).
 */
import type { CacheProvider } from "@agentbadge/cache";

import { tryGetCache } from "../cache";
import { assertBountyTransition } from "../bounties/lifecycle";
import {
  bountyStoreReady,
  getBounty,
  upsertBounty,
} from "../bounties/store";
import { boardStore, type BoardStoreBackend } from "./store";
import {
  newEntryId,
  newOutboxId,
  boardIdempotencyKey,
  type BoardCardRecord,
} from "./types";
import { BOARD_MAX_ATTEMPTS } from "./claim-sig";
import type { BugLoopDeps } from "./bug-loop";

const SWEEP_LOCK_TTL_SEC = 60;

export interface SweepDeps {
  now?: () => number;
  cache?: CacheProvider | null;
}

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
    // Audit M-5: fail-closed — a cache error returns -1 and skips this
    // tick; two sweeper replicas must never both enter the loop.
    const n = await cache
      .incr("board:sweep:lock", SWEEP_LOCK_TTL_SEC)
      .catch(() => -1);
    if (n !== 1) return { swept: [], skipped: true };
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
  // Audit C-4: a dead `lc.ok ? open : open` ternary previously let a
  // second tick resurrect a cancelled/rejected bounty. Skip the reopen
  // when the lifecycle refuses it.
  if (!lc.ok) {
    return false;
  }
  upsertBounty({
    ...bounty,
    status: "open",
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
