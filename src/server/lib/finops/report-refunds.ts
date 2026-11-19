/**
 * EPIC-226 — refund-window attribution for `finReport`. Split from
 * `reports.ts` for the 300-line module cap: `refundTotals` maps
 * completed refund intents into report windows and sums them.
 */

import type { Database } from "@agentbadge/database";

import { isDecimalString, sumDecimals } from "./guards";
import {
  type FinOpsResult,
  type ReportPeriod,
  fail,
  ok,
} from "./types";

/**
 * Sum refunds inside the report window: every intent counts by its
 * own completedAtMs; REFUNDED payments with NO intent rows fall back
 * to the payment amount (the Stripe path).
 */
export async function refundTotals(
  db: Database,
  terminal: readonly { id: string; status: string; amount: string }[],
  period: ReportPeriod,
): Promise<
  FinOpsResult<{ refundsTotal: string; refundedPayments: number }>
> {
  // N5-5: the intent scan can throw (corrupt row → repo `dec()`
  // throw) — map to a controlled error, not a 500.
  let completedIntents;
  try {
    completedIntents = await db.finops.refundIntents.list({
      status: "COMPLETED",
    });
  } catch (e) {
    return fail(
      "PROVIDER_ERROR",
      `corrupt refund intent data: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // A COMPLETED row without completedAtMs is data corruption — the
  // intent would silently drop out of EVERY window and the refund
  // would vanish from reports. Surface it, don't skip it.
  const undated = completedIntents.find(
    (ri) => ri.completedAtMs === null || ri.completedAtMs === undefined,
  );
  if (undated) {
    return fail(
      "PROVIDER_ERROR",
      `completed refund intent ${undated.id} has no completedAtMs — manual reconciliation required`,
    );
  }
  // H6: only refunds completed INSIDE the report window count — an
  // intent completed outside the period is that period's number.
  const inWindow = (ri: (typeof completedIntents)[number]): boolean =>
    ri.completedAtMs !== null &&
    ri.completedAtMs !== undefined &&
    (period.sinceMs === undefined ||
      ri.completedAtMs >= period.sinceMs) &&
    (period.untilMs === undefined ||
      ri.completedAtMs <= period.untilMs);
  const windowedByPayment = new Map<string, string[]>();
  // N4-7: EVERY intent counts by its own completedAtMs window —
  // refund attribution lives on the intent row, so a payment's
  // partial refunds land in the windows they completed in. The
  // p.amount fallback applies only to REFUNDED payments that have NO
  // intent rows at all (the Stripe path) — an all-time check, not a
  // windowed one, so a boundary-straddling history isn't double
  // counted.
  const hasAnyIntents = new Set<string>();
  for (const ri of completedIntents) {
    hasAnyIntents.add(ri.paymentId);
    if (inWindow(ri)) {
      windowedByPayment.set(ri.paymentId, [
        ...(windowedByPayment.get(ri.paymentId) ?? []),
        ri.amount,
      ]);
    }
  }
  const refundedIds = new Set(
    terminal.filter((p) => p.status === "REFUNDED").map((p) => p.id),
  );
  let refundsTotal = "0";
  for (const p of terminal.filter((x) => x.status === "REFUNDED")) {
    if (!hasAnyIntents.has(p.id)) {
      if (typeof p.amount !== "string" || !isDecimalString(p.amount)) {
        return fail(
          "PROVIDER_ERROR",
          `corrupt amount on refunded payment ${p.id} — manual reconciliation required`,
        );
      }
      refundsTotal = sumDecimals([refundsTotal, p.amount]);
    }
  }
  for (const [pid, amounts] of windowedByPayment) {
    const bad = amounts.find(
      (a) => typeof a !== "string" || !isDecimalString(a),
    );
    if (bad !== undefined) {
      return fail(
        "PROVIDER_ERROR",
        `corrupt refund intent amount on payment ${pid} — manual reconciliation required`,
      );
    }
    refundsTotal = sumDecimals([refundsTotal, sumDecimals(amounts)]);
  }
  return ok({
    // Canonical money form — an empty window still reports "0.00".
    refundsTotal: sumDecimals([refundsTotal]),
    refundedPayments: refundedIds.size,
  });
}
