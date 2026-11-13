/**
 * SLICE-222-6 — admin refund endpoint:
 * POST /api/v1/payments/:id/refund {txHash, refundedBy?, note?}
 * Request → REFUND_REQUEST exception → markRefunded → REFUNDED +
 * audit + exception RESOLVED.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createPaymentsApiRoutes } from "../src/server/routes/payments-api";
import type { PaymentsCheckout } from "../src/server/lib/payments-api";

const ADMIN_KEY = "test-admin-key-2226";
const TX =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function app(result: { status: string; reason?: string }) {
  const calls: Record<string, unknown>[] = [];
  const checkout = {
    refundPaymentOps: async (input: Record<string, unknown>) => {
      calls.push(input);
      return result;
    },
  } as unknown as PaymentsCheckout;
  return { routes: createPaymentsApiRoutes(() => checkout), calls };
}

function postRefund(
  routes: ReturnType<typeof createPaymentsApiRoutes>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return routes.request("/api/v1/payments/pay1/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/payments/:id/refund", () => {
  const prev = process.env.ADMIN_API_KEY;
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  });

  it("401 without admin key", async () => {
    const { routes } = app({ status: "REFUNDED" });
    const res = await postRefund(routes, { txHash: TX });
    expect(res.status).toBe(401);
  });

  it("400 on malformed txHash", async () => {
    const { routes } = app({ status: "REFUNDED" });
    const res = await postRefund(routes, { txHash: "short" }, {
      "X-Admin-Key": ADMIN_KEY,
    });
    expect(res.status).toBe(400);
  });

  it("200 → refund recorded, input forwarded to refundPaymentOps", async () => {
    const { routes, calls } = app({ status: "REFUNDED" });
    const res = await postRefund(
      routes,
      { txHash: TX, refundedBy: "ops-alice", note: "asked" },
      { "X-Admin-Key": ADMIN_KEY },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payment.status).toBe("REFUNDED");
    expect(body.payment.refundTxHash).toBe(TX);
    expect(calls[0]).toMatchObject({
      paymentId: "pay1",
      txHash: TX,
      refundedBy: "ops-alice",
      note: "asked",
    });
  });

  it("409 when payment already refunded", async () => {
    const { routes } = app({
      status: "FAILED",
      reason: "payment pay1 is already refunded",
    });
    const res = await postRefund(routes, { txHash: TX }, {
      "X-Admin-Key": ADMIN_KEY,
    });
    expect(res.status).toBe(409);
  });

  it("404 on unknown payment", async () => {
    const { routes } = app({
      status: "FAILED",
      reason: "unknown payment pay1",
    });
    const res = await postRefund(routes, { txHash: TX }, {
      "X-Admin-Key": ADMIN_KEY,
    });
    expect(res.status).toBe(404);
  });
});
