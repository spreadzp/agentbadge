/**
 * SLICE-160-1 (EPIC-160): domain metrics for the payment stack.
 *
 * One registry-side module owns every `agentbadge_payments_*` series —
 * the circle-payments package stays prom-client-free and calls the
 * injected PaymentMetricsHooks (D1-160). Label whitelist (D2-160):
 * rail | network | result | reason_class | route_key | target.
 * NEVER: payer, addresses, amounts, txHash (cardinality + PII).
 */

import { Counter, Gauge, Histogram } from "prom-client";
import type { PaymentMetricsHooks } from "@agentbadge/circle-payments";
import { registry } from "./metrics";

export { registry };

export const paymentsVerifyTotal = new Counter({
  name: "agentbadge_payments_verify_total",
  help: "Payment verify dispatches",
  labelNames: ["rail", "network", "result"] as const,
  registers: [registry],
});

export const paymentsSettleTotal = new Counter({
  name: "agentbadge_payments_settle_total",
  help: "Payment settle dispatches",
  labelNames: ["rail", "network", "result"] as const,
  registers: [registry],
});

export const paymentsVerifyDurationMs = new Histogram({
  name: "agentbadge_payments_verify_duration_ms",
  help: "Verify duration in milliseconds",
  labelNames: ["rail"] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 15000],
  registers: [registry],
});

export const paymentsSettleDurationMs = new Histogram({
  name: "agentbadge_payments_settle_duration_ms",
  help: "Settle duration in milliseconds",
  labelNames: ["rail"] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000],
  registers: [registry],
});

export const paymentsFailuresTotal = new Counter({
  name: "agentbadge_payments_failures_total",
  help: "Fulfillment failures after a confirmed settle",
  labelNames: ["rail", "reason_class"] as const,
  registers: [registry],
});

export const gatewayTransfersPending = new Gauge({
  name: "agentbadge_gateway_transfers_pending",
  help: "Gateway transfers observed pending settlement",
  registers: [registry],
});

/** Gateway batch settlement takes minutes-hours by design — this is a
 *  lag histogram for dashboards, never an alert source (EPIC-160). */
export const gatewayTimeToSettleSeconds = new Histogram({
  name: "agentbadge_gateway_time_to_settle_seconds",
  help: "Observed gateway transfer settle lag in seconds",
  buckets: [60, 300, 900, 1800, 3600, 14400, 28800],
  registers: [registry],
});

export const routePriceUsd = new Gauge({
  name: "agentbadge_route_price_usd",
  help: "Advertised USD price per PRICE_TABLE route key",
  labelNames: ["route_key"] as const,
  registers: [registry],
});

export const facilitatorUp = new Gauge({
  name: "agentbadge_facilitator_up",
  help: "Facilitator probe status (1 = up, 0 = down)",
  labelNames: ["target"] as const,
  registers: [registry],
});

export type PaymentReasonClass =
  | "fulfillment"
  | "provider"
  | "timeout"
  | "other";

/** Normalize a raw failure reason into a low-cardinality class label.
 *  Order matters: timeout first (transport timeouts often carry
 *  provider-ish words), then provider, then fulfillment, else other. */
export function classifyReason(reason: string): PaymentReasonClass {
  const r = reason.toLowerCase();
  if (/timed?\s*out|etimedout|timeout|econnaborted|deadline/.test(r)) {
    return "timeout";
  }
  if (/facilitator|gateway|provider|\b5\d\d\b|econnrefused|econnreset|503|502/.test(r)) {
    return "provider";
  }
  if (/fulfill|handler|route|threw|boom/.test(r)) {
    return "fulfillment";
  }
  return "other";
}

/** Canonical package rail name → label value. arcSelfSettle renders as
 *  "arc"; gateway-batched exact already arrives as "gateway". */
export function railLabel(rail: string | undefined): string {
  if (rail === "arcSelfSettle") return "arc";
  if (rail === "gateway" || rail === "exact" || rail === "arc") {
    return rail;
  }
  return "unknown";
}

export interface FailureLike {
  rail?: string;
  scheme?: string;
  reason: string;
}

/**
 * SLICE-160-1 wiring helper: resolve the metrics hooks to inject into
 * every router plus a composed failure-alert (metric increment first,
 * then the caller's alert). Keeps circle-payments.ts small.
 * Generic over the failure record so the package's FailureAlert fits.
 */
export function resolvePaymentMetrics<F extends FailureLike>(
  metrics: PaymentMetricsHooks | undefined,
  onFailure: ((f: F) => void) | undefined,
): { hooks: PaymentMetricsHooks; onFailure(f: F): void } {
  const pm = createPaymentMetrics();
  return {
    hooks: metrics ?? pm.hooks,
    onFailure(f: F) {
      pm.failureAlert(f);
      onFailure?.(f);
    },
  };
}

/**
 * Build PaymentMetricsHooks bound to this registry — injected into
 * createPaymentRouter via deps (D1-160).
 */
export function createPaymentMetrics() {
  return {
    hooks: {
      onVerify(rail: string, network: string, result: "ok" | "invalid" | "error", ms: number) {
        const r = railLabel(rail);
        paymentsVerifyTotal.inc({ rail: r, network, result });
        paymentsVerifyDurationMs.observe({ rail: r }, ms);
      },
      onSettle(rail: string, network: string, result: "ok" | "fail" | "error", ms: number) {
        const r = railLabel(rail);
        paymentsSettleTotal.inc({ rail: r, network, result });
        paymentsSettleDurationMs.observe({ rail: r }, ms);
      },
    },
    /** Compose into the failure-alert path: increments
     *  paymentsFailuresTotal{rail, reason_class} per recorded failure. */
    failureAlert(failure: { rail?: string; scheme?: string; reason: string }) {
      const rail =
        railLabel(failure.rail) !== "unknown"
          ? railLabel(failure.rail)
          : failure.scheme === "eip3009-client-broadcast"
            ? "arc"
            : failure.scheme === "exact"
              ? "exact"
              : "unknown";
      paymentsFailuresTotal.inc({
        rail,
        reason_class: classifyReason(failure.reason),
      });
    },
  };
}
