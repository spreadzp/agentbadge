/**
 * SLICE-225-6 (EPIC-225): reversal pass — extracted from
 * sweeper.ts to keep it under the max-lines lint bound.
 *
 * Walks ACTIVE sourced entitlements in a rotating keyset cursor
 * so no row is starved. A grant is revoked ONLY on an explicit
 * reversal status; missing payment rows and ambiguous statuses
 * retain the entitlement. The revoke carries a `payment-reversal`
 * payload marker so a later CONFIRMED state can reactivate
 * (audit H-5 / v2 N-4..N-6).
 */
import { REVERSAL_STATUSES } from "./sweeper-helpers";
import type {
  EntitlementSweepDeps,
  EntitlementSweepResult,
} from "./sweeper";

export async function runReversalPass(
  deps: EntitlementSweepDeps,
  result: EntitlementSweepResult,
  maxReversals: number,
  err: (stage: string, e: unknown) => void,
): Promise<void> {
  let cursor = deps.reversalCursor;
  try {
    const rows =
      (await deps.entitlements.listActiveWithSource?.(
        maxReversals,
        cursor,
      )) ?? [];
    if (rows.length > 0) {
      // Opaque composite cursor `<createdAt>|<id>` — an ordering
      // key, not a row reference: the cursor row may leave ACTIVE
      // (revoked/expired) before the next tick and the position
      // must still hold (otherwise the window restarts and rows
      // past it starve — the bare-id version did exactly this).
      const last = rows[rows.length - 1];
      result.reversalCursor =
        rows.length >= maxReversals
          ? `${last.createdAt}|${last.id}`
          : null; // wrapped — restart the window next tick
    }
    for (const row of rows) {
      if (!row.sourcePaymentId) continue; // store already filters
      try {
        const payment = await deps.payments.payments.getById(
          row.sourcePaymentId,
        );
        if (payment === null) continue; // missing ⇒ retain (N-5)
        if (!REVERSAL_STATUSES.has(payment.status)) continue;
        // N-6: shrink the flip-race — re-read once before revoking
        // so a status that just flipped back to CONFIRMED wins.
        const fresh = await deps.payments.payments.getById(
          row.sourcePaymentId,
        );
        if (!fresh || !REVERSAL_STATUSES.has(fresh.status)) continue;
        await deps.entitlements.revokeForReversal(row.id);
        result.revoked++;
      } catch (e) {
        err(`reversal:${row.id}`, e);
      }
    }
  } catch (e) {
    err("reversal-feed", e);
  }
}
