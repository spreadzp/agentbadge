/**
 * SLICE-176-6: approval TTL sweeper — split from approvals.ts
 * (300-line file limit). One interval timer per process; each tick
 * flips overdue pending→expired via store.expireOverdue() (the sole
 * persisting actor) and emits approval.expired per record.
 */
import type { ApprovalStore } from "./approvals";
import { emitSpendAlert } from "./audit";

/**
 * Expire overdue pending intents + emit approval.expired per record.
 * Returns count of newly expired. Called by the interval sweeper and
 * directly in tests.
 */
export async function sweepExpiredApprovals(opts: {
  store: ApprovalStore;
  now?: number;
}): Promise<number> {
  const expired = await opts.store.expireOverdue(opts.now);
  for (const a of expired) {
    emitSpendAlert("approval.expired", a.wallet, {
      approvalId: a.id,
      amountUsd: a.amountUsd,
      kind: a.kind,
      refId: a.refId,
      expiresAt: a.expiresAt,
    });
  }
  return expired.length;
}

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

/** One sweeper per process (spec): interval tick + unref. */
export function startApprovalSweeper(deps: {
  store: ApprovalStore;
  intervalMs?: number;
}): void {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(() => {
    void sweepExpiredApprovals({ store: deps.store }).catch(() => {
      /* sweeper errors must never crash the loop */
    });
  }, deps.intervalMs ?? 60_000);
  sweeperTimer.unref();
}

export function stopApprovalSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}
