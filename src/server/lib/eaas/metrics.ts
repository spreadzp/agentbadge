/**
 * SLICE-154-6: EaaS SLA metrics — in-memory counters for /api/eaas/status
 * plus prom-client export into the shared registry (EPIC-149 pattern).
 *
 * Latency is measured at the issueVerdict boundary (sync path) and at
 * request completion (async path); delivery rate covers webhook fan-out.
 */

import { Counter, Histogram } from "prom-client";
import { registry } from "../../metrics/metrics";

const verdictLatency = new Histogram({
  name: "agentbadge_eaas_verdict_latency_ms",
  help: "EaaS verdict issue latency in milliseconds",
  buckets: [50, 250, 500, 1000, 5000, 15000, 60000],
  registers: [registry],
});

const webhookDeliveries = new Counter({
  name: "agentbadge_eaas_webhook_deliveries_total",
  help: "EaaS verdict webhook deliveries",
  labelNames: ["result"],
  registers: [registry],
});

export interface EaasMetrics {
  startedAt: number;
  /** Record one verdict issue with its latency. */
  observeVerdict(latencyMs: number): void;
  /** Record one webhook delivery attempt outcome (post-retries). */
  observeWebhook(ok: boolean): void;
  /** Aggregates for GET /api/eaas/status. */
  snapshot(): {
    uptimeSec: number;
    verdicts: { count: number; avgLatencyMs: number };
    webhooks: { delivered: number; failed: number; deliveryRate: number };
  };
}

export function createEaasMetrics(): EaasMetrics {
  let verdictCount = 0;
  let latencySum = 0;
  let delivered = 0;
  let failed = 0;
  const startedAt = Date.now();
  return {
    startedAt,
    observeVerdict(latencyMs) {
      verdictCount += 1;
      latencySum += latencyMs;
      verdictLatency.observe(latencyMs);
    },
    observeWebhook(ok) {
      if (ok) delivered += 1;
      else failed += 1;
      webhookDeliveries.inc({ result: ok ? "delivered" : "failed" });
    },
    snapshot() {
      const total = delivered + failed;
      return {
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        verdicts: {
          count: verdictCount,
          avgLatencyMs: verdictCount
            ? Math.round(latencySum / verdictCount)
            : 0,
        },
        webhooks: {
          delivered,
          failed,
          deliveryRate: total ? delivered / total : 1,
        },
      };
    },
  };
}
