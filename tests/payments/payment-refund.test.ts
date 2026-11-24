/**
 * SLICE-222-6 — admin refund endpoint:
 * POST /api/v1/payments/:id/refund {txHash, refundedBy?, note?}
 * Request → REFUND_REQUEST exception → markRefunded → REFUNDED +
 * audit + exception RESOLVED.
 */
import { describe, expect, it } from "vitest";
import { createPaymentsApiRoutes } from "../../src/server/routes/payments/payments-api";
import type { PaymentsCheckout } from "../../src/server/lib/payments-api";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";


const TX =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function app(result: { status: string; reason?: string }) {
  const calls: Record<string, unknown>[] = [];
  const checkout = {
    refundPaymentOps: async (input: Record<string, unknown>) => {
      calls.push(input);
      return result;
    },
  } as unknown as PaymentsCheckout;
  // 264-8: refund rides an operator credential — refundedBy is the
  // credential principal.id, never a body field.
  const opStore = createMemoryOperatorStore();
  const { key, operatorId } = await seedOperator(opStore);
  return {
    routes: createPaymentsApiRoutes(() => checkout, opStore),
    calls,
    opKey: key,
    operatorId,
  };
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

  it("401 without an operator credential", async () => {
    const { routes } = await app({ status: "REFUNDED" });
    const res = await postRefund(routes, { txHash: TX });
    expect(res.status).toBe(401);
  });

  it("400 on malformed txHash", async () => {
    const { routes, opKey } = await app({ status: "REFUNDED" });
    const res = await postRefund(routes, { txHash: "short" }, {
      "X-Admin-Key": opKey,
    });
    expect(res.status).toBe(400);
  });

  it("400 on a self-asserted refundedBy field", async () => {
    const { routes, opKey } = await app({ status: "REFUNDED" });
    const res = await postRefund(
      routes,
      { txHash: TX, refundedBy: "spoofed" },
      { "X-Admin-Key": opKey },
    );
    expect(res.status).toBe(400);
  });

  it("200 → refund recorded, principal forwarded to refundPaymentOps", async () => {
    const { routes, calls, opKey, operatorId } = await app({ status: "REFUNDED" });
    const res = await postRefund(
      routes,
      { txHash: TX, note: "asked" },
      { "X-Admin-Key": opKey },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payment.status).toBe("REFUNDED");
    expect(body.payment.refundTxHash).toBe(TX);
    expect(calls[0]).toMatchObject({
      paymentId: "pay1",
      txHash: TX,
      refundedBy: operatorId,
      note: "asked",
    });
  });

  it("409 when payment already refunded", async () => {
    const { routes, opKey } = await app({
      status: "FAILED",
      reason: "payment pay1 is already refunded",
    });
    const res = await postRefund(routes, { txHash: TX }, {
      "X-Admin-Key": opKey,
    });
    expect(res.status).toBe(409);
  });

  it("404 on unknown payment", async () => {
    const { routes, opKey } = await app({
      status: "FAILED",
      reason: "unknown payment pay1",
    });
    const res = await postRefund(routes, { txHash: TX }, {
      "X-Admin-Key": opKey,
    });
    expect(res.status).toBe(404);
  });
});
