/**
 * SLICE-160-3 (EPIC-160): payment alert sink MVP.
 *
 * The onFailure path already writes structured logs + Sentry;
 * this adds an optional external webhook POST gated by
 * PAYMENT_ALERT_WEBHOOK_URL (keeperhub notify pattern).
 *
 * Rate-limit: max one webhook per reason_class per 5min —
 * noise filter, the failureStore keeps every record anyway.
 * Alerting is strictly best-effort: never throws into the
 * request path (recordFailure contract).
 */

import type { PaymentFailure } from "@agentbadge/circle-payments";
import { classifyReason } from "../metrics/payments";

const COOLDOWN_MS = 5 * 60_000;

export interface PaymentAlertSinkOptions {
  /** Webhook target — undefined disables the sink entirely */
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests */
  nowMs?: () => number;
}

/**
 * Fire-and-forget failure alert webhook. Returns a FailureAlert-shaped
 * callback: (f: PaymentFailure) => void.
 */
export function createPaymentAlertSink(
  opts: PaymentAlertSinkOptions,
): (f: PaymentFailure) => void {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.nowMs ?? Date.now;
  const lastSentAt = new Map<string, number>();

  return (f) => {
    if (!opts.webhookUrl) return;
    const reasonClass = classifyReason(f.reason);
    const last = lastSentAt.get(reasonClass) ?? -Infinity;
    if (now() - last < COOLDOWN_MS) return;
    lastSentAt.set(reasonClass, now());

    const body = JSON.stringify({
      kind: "payment.fulfillment_failure",
      reasonClass,
      scheme: f.scheme,
      rail: f.rail ?? null,
      network: f.network,
      reason: f.reason,
      txRef: f.txRef ?? null,
      requestId: f.requestId ?? null,
      at: f.at ?? new Date().toISOString(),
    });
    void fetchImpl(opts.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => {
      /* alerting must not throw into the request path */
    });
  };
}
