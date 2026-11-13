/**
 * Audit C-1 sweeper (222-7): a CONFIRMED payment must carry a durable
 * fulfill-done marker. claimed/unresolved/effect-failed all mean
 * paid-but-not-delivered — and nothing else ever revisits it, so the
 * reconciliation pass is the last line of defence.
 *
 * Extracted from usdc-reconciliation.ts to keep both files under the
 * 300-line lint limit.
 */

import type {
  PaymentServiceStores,
  ReconAttempt,
} from "@agentbadge/payments";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface FulfillmentGapSweepDeps {
  stores: PaymentServiceStores;
  caip2: string;
  atMs: number;
}

export interface FulfillmentGapSweepResult {
  count: number;
  exceptionsWritten: number;
  errors: { stage: string; message: string }[];
}

export async function sweepFulfillmentGaps(
  recon: ReconAttempt[],
  deps: FulfillmentGapSweepDeps,
): Promise<FulfillmentGapSweepResult> {
  const out: FulfillmentGapSweepResult = {
    count: 0,
    exceptionsWritten: 0,
    errors: [],
  };
  const events = deps.stores.events;
  const exceptions = deps.stores.exceptions;
  if (!events) return out;

  const confirmedPayments = [
    ...new Set(
      recon
        .filter((a) => a.status === "CONFIRMED")
        .map((a) => a.paymentId),
    ),
  ];
  for (const paymentId of confirmedPayments) {
    try {
      const rows = await events.listByPayment(paymentId);
      const fulfilled = rows.some(
        (e) => e.entity === "FULFILLMENT" && e.to === "done",
      );
      if (fulfilled) continue;
      out.count++;
      const appended = await exceptions?.append({
        id: `exc-recon-CONFIRMED_WITHOUT_FULFILLMENT-fulfill-gap:${paymentId}`,
        paymentId,
        kind: "RECONCILIATION_MISMATCH",
        severity: "CRITICAL",
        details: {
          mismatchKind: "CONFIRMED_WITHOUT_FULFILLMENT",
          reason:
            `payment ${paymentId} is CONFIRMED but has no ` +
            `fulfill-done marker — paid, never delivered`,
          network: deps.caip2,
        },
        status: "OPEN",
        createdAtMs: deps.atMs,
      });
      if (appended) out.exceptionsWritten++;
    } catch (e) {
      out.errors.push({
        stage: `fulfill-gap:${paymentId}`,
        message: errMsg(e),
      });
    }
  }
  return out;
}
