/**
 * SLICE-160-3 tests — payment alert sink MVP.
 *
 * Env-gated PAYMENT_ALERT_WEBHOOK_URL POST on every recorded
 * failure, rate-limited to 1 / 5min per reason_class (noise
 * filter). Never throws into the request path — alerting is
 * strictly best-effort (recordFailure contract).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PaymentFailure } from "@agentbadge/circle-payments";
import { createPaymentAlertSink } from "../src/server/lib/payment-alerts";

function failure(overrides: Partial<PaymentFailure> = {}): PaymentFailure {
  return {
    scheme: "exact",
    network: "eip155:84532",
    payer: "0x1111111111111111111111111111111111111111",
    amount: "1000000",
    reason: "handler exploded",
    ...overrides,
  };
}

describe("payment alert sink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("no webhook configured → never fetches, no-op", () => {
    const fetchImpl = vi.fn();
    const sink = createPaymentAlertSink({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    sink(failure());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts failure summary to the webhook", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok"));
    const sink = createPaymentAlertSink({
      webhookUrl: "https://alerts.example.com/hook",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    sink(failure({ rail: "exact", reason: "handler exploded" }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://alerts.example.com/hook");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.kind).toBe("payment.fulfillment_failure");
    expect(body.reasonClass).toBe("fulfillment");
    expect(body.scheme).toBe("exact");
    expect(body.rail).toBe("exact");
    expect(body.network).toBe("eip155:84532");
    expect(body.reason).toBe("handler exploded");
  });

  it("rate-limits to one webhook per reason_class per 5min window", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok"));
    let now = 1_000_000;
    const sink = createPaymentAlertSink({
      webhookUrl: "https://alerts.example.com/hook",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => now,
    });
    sink(failure({ reason: "handler exploded" })); // fulfillment → sends
    sink(failure({ reason: "handler crashed" }));  // fulfillment → suppressed
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    // Different reason_class → separate budget, sends immediately.
    sink(failure({ reason: "facilitator 503" })); // provider → sends
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

    // Same class after cooldown → sends again.
    now += 5 * 60_000 + 1;
    sink(failure({ reason: "handler exploded" }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
  });

  it("never throws when the webhook fails", () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("net down"));
    const sink = createPaymentAlertSink({
      webhookUrl: "https://alerts.example.com/hook",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(() => sink(failure())).not.toThrow();
  });
});
