/**
 * EPIC-226 / SLICE-226-2 — financial reports (D-226-5: on-demand
 * aggregation, no materialized tables at v1 volume).
 *
 * `finReport` computes gross/net volume, fee estimates, and
 * provider/product/network splits for a terminal-transition window —
 * each payment counted ONCE at its terminal state (updatedAtMs is the
 * transition timestamp). RECORD_ONLY commerce mirrors are surfaced as
 * an informational block, strictly outside revenue.
 */

import type { Database, PaymentAttemptRow } from "@agentbadge/database";

import {
  decimalSub,
  feeOf,
  isDecimalString,
  sumDecimals,
} from "./guards";
import {
  type FinOpsResult,
  type FinReport,
  type ReportPeriod,
  fail,
  ok,
} from "./types";

/** Providers that settle on-chain (USDC) — feed the byNetwork split. */
const ONCHAIN_PROVIDERS = new Set(["DIRECT_USDC", "X402", "HEDERA"]);
/** Terminal payment statuses — the report counts transitions. */
const TERMINAL_PAYMENT_STATUSES = [
  "CONFIRMED",
  "REFUNDED",
  "FAILED",
  "EXPIRED",
];
const REVENUE_STATUSES = ["CONFIRMED", "REFUNDED"];

/** x402 facilitator fee rate in basis points — estimated until real
 *  facilitator fee data lands in attempt payloads (env-configurable). */
function facilitatorFeeBps(): number {
  const raw = process.env.FINOPS_X402_FEE_BPS;
  const v = raw === undefined ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Latest CONFIRMED attempt per payment — provider attribution. */
function groupConfirmedAttempts(
  attempts: readonly PaymentAttemptRow[],
): Map<string, PaymentAttemptRow> {
  const map = new Map<string, PaymentAttemptRow>();
  for (const a of attempts) {
    if (!map.has(a.paymentId)) map.set(a.paymentId, a);
  }
  return map;
}

/** Provider/product/network splits + fee estimation. */
function buildSplits(
  revenue: readonly { id: string; amount: string; productId?: string | null }[],
  confirmedByPayment: Map<string, PaymentAttemptRow>,
): {
  byProvider: Record<string, string>;
  byProduct: Record<string, string>;
  byNetwork: Record<string, string>;
  stripeEstimated: string;
  facilitatorEstimated: string;
} {
  // N13: null-prototype maps — a DB key like "__proto__" must not
  // silently drop volume or pollute the prototype chain.
  const byProvider: Record<string, string> = Object.create(null);
  const byProduct: Record<string, string> = Object.create(null);
  const byNetwork: Record<string, string> = Object.create(null);
  const providerAmounts = new Map<string, string[]>();
  for (const p of revenue) {
    const att = confirmedByPayment.get(p.id) ?? null;
    const provider = att?.provider ?? "unknown";
    byProvider[provider] = sumDecimals([
      byProvider[provider] ?? "0",
      p.amount,
    ]);
    const product = p.productId ?? "none";
    byProduct[product] = sumDecimals([byProduct[product] ?? "0", p.amount]);
    if (att && ONCHAIN_PROVIDERS.has(provider)) {
      const network = att.network ?? "unknown";
      byNetwork[network] = sumDecimals([byNetwork[network] ?? "0", p.amount]);
    }
    providerAmounts.set(provider, [
      ...(providerAmounts.get(provider) ?? []),
      p.amount,
    ]);
  }
  let stripeEstimated = "0";
  for (const amt of providerAmounts.get("STRIPE") ?? []) {
    stripeEstimated = sumDecimals([
      stripeEstimated,
      feeOf(amt, 290, "0.30"), // Stripe ≈ 2.9% + $0.30
    ]);
  }
  let facilitatorEstimated = "0";
  const x402Bps = facilitatorFeeBps();
  if (x402Bps > 0) {
    for (const amt of providerAmounts.get("X402") ?? []) {
      facilitatorEstimated = sumDecimals([
        facilitatorEstimated,
        feeOf(amt, x402Bps),
      ]);
    }
  }
  return {
    byProvider,
    byProduct,
    byNetwork,
    stripeEstimated,
    facilitatorEstimated,
  };
}

/**
 * Refund totals — each refunded payment counted once. A COMPLETED
 * intent carries the (possibly partial) refunded amount; a
 * stripe-refunded payment without an intent contributes its full
 * amount. Intents on still-CONFIRMED payments are partial refunds.
 */
async function refundTotals(
  db: Database,
  terminal: readonly { id: string; status: string; amount: string }[],
  period: ReportPeriod,
): Promise<
  FinOpsResult<{ refundsTotal: string; refundedPayments: number }>
> {
  const completedIntents = await db.finops.refundIntents.list({
    status: "COMPLETED",
  });
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

/**
 * Financial report for a terminal-transition window: gross/net
 * volume, fee estimates, splits, refunds — each payment counted ONCE
 * at its terminal state. RECORD_ONLY mirrors are informational only.
 */
export async function finReport(
  db: Database,
  period: ReportPeriod = {},
): Promise<FinOpsResult<FinReport>> {
  const payments = await db.payments.payments.list({
    statuses: TERMINAL_PAYMENT_STATUSES,
    updatedSinceMs: period.sinceMs,
    updatedUntilMs: period.untilMs,
  });
  const revenue = payments.filter((p) =>
    REVENUE_STATUSES.includes(p.status),
  );
  // N4-4: one corrupt revenue row must not crash the report with an
  // untyped throw — surface the offending payment id in a controlled
  // PROVIDER_ERROR instead (the row needs manual reconciliation).
  const corrupt = revenue.find(
    (p) => typeof p.amount !== "string" || !isDecimalString(p.amount),
  );
  if (corrupt) {
    return fail(
      "PROVIDER_ERROR",
      `corrupt amount on revenue payment ${corrupt.id} — manual reconciliation required`,
    );
  }
  const attempts = await db.payments.attempts.list({
    statuses: ["CONFIRMED"],
  });
  const confirmedByPayment = groupConfirmedAttempts(attempts);
  const splits = buildSplits(revenue, confirmedByPayment);
  const totals = await refundTotals(db, payments, period);
  if (!totals.ok) return totals;
  const { refundsTotal, refundedPayments } = totals.value;
  const grossVolume = sumDecimals(revenue.map((p) => p.amount));
  const feesTotal = sumDecimals([
    splits.stripeEstimated,
    splits.facilitatorEstimated,
  ]);
  const netRevenue = decimalSub(
    decimalSub(grossVolume, refundsTotal),
    feesTotal,
  );

  // RECORD_ONLY mirrors — informational, strictly outside revenue.
  const mirrors = await db.commerce.payments.list({
    mode: "RECORD_ONLY",
    statuses: ["PAYMENT_RECORDED", "PAYMENT_VERIFIED"],
    recordedSinceMs: period.sinceMs,
    recordedUntilMs: period.untilMs,
  });
  const mirrorCurrencies = new Set(
    mirrors.map((m) => m.currency ?? "USD"),
  );
  // N4-4: RECORD_ONLY mirrors are externally recorded and
  // informational — one non-canonical mirror amount must not 500 the
  // whole revenue report. Malformed entries are counted, not summed.
  let mirrorVolume = "0";
  let mirrorInvalid = 0;
  for (const m of mirrors) {
    if (typeof m.amount !== "string" || !isDecimalString(m.amount)) {
      mirrorInvalid += 1;
      continue;
    }
    mirrorVolume = sumDecimals([mirrorVolume, m.amount]);
  }
  const recordedOnly = {
    count: mirrors.length,
    volume: mirrorVolume,
    ...(mirrorInvalid > 0 ? { invalidAmounts: mirrorInvalid } : {}),
    currency:
      mirrorCurrencies.size === 1 ? [...mirrorCurrencies][0]! : "MIXED",
  };

  return ok({
    period: {
      sinceMs: period.sinceMs ?? null,
      untilMs: period.untilMs ?? null,
    },
    grossVolume,
    refundsTotal,
    fees: {
      stripeEstimated: splits.stripeEstimated,
      facilitatorEstimated: splits.facilitatorEstimated,
      total: feesTotal,
      basis: "estimated",
    },
    netRevenue,
    byProvider: splits.byProvider,
    byProduct: splits.byProduct,
    byNetwork: splits.byNetwork,
    counts: {
      payments: revenue.length,
      refundedPayments,
    },
    recordedOnly,
  });
}
