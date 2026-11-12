/**
 * SLICE-242-10 (D-242-15): seam integration — router.settle failure
 * triggers alertSettleFailure (deduped downstream); router.verify
 * failure logs but NEVER alerts.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PaymentRouter } from "@agentbadge/circle-payments";
import { createSettleSeam } from "../src/server/lib/x402-settle-seam";

const alertSpy = vi.fn<(a: Record<string, unknown>) => Promise<void>>(
  async () => undefined,
);
vi.mock("../src/server/services/settle-failure-alert.js", () => ({
  alertSettleFailure: (a: Record<string, unknown>) => alertSpy(a),
}));
// Success-side effects are irrelevant here; keep them inert.
vi.mock("../src/server/services/payment-notification.js", () => ({
  notifyX402Payment: async () => undefined,
}));
vi.mock("../src/server/lib/econ-ledger/x402.js", () => ({
  emitX402Settle: () => undefined,
}));

const PAYER = "0x1111111111111111111111111111111111111111";
const REQ = {
  scheme: "exact",
  network: "eip155:5042",
  asset: "0x3600000000000000000000000000000000000000",
  payTo: "0x2222222222222222222222222222222222222222",
  amount: "1000000",
};

const payload = Buffer.from(
  JSON.stringify({ x402Version: 2, accepted: REQ, payload: { sig: "0xs" } }),
).toString("base64");

function appWith(router: PaymentRouter): Hono {
  const app = new Hono();
  const seam = createSettleSeam({
    router,
    amountAtomic: () => "1000000",
    resourceUrl: "/api/total-scan",
  });
  app.post("/work", async (c) => {
    const r = await seam(c);
    if (!r) return c.json({ error: "payment required" }, 402);
    return c.json({ ok: true });
  });
  return app;
}

function router(over: Partial<PaymentRouter>): PaymentRouter {
  return {
    acceptsFor: () => [REQ],
    verify: async () => ({ isValid: true, payer: PAYER }),
    settle: async () => ({ success: true, transaction: "0xtx" }),
    ...over,
  } as unknown as PaymentRouter;
}

const post = (app: Hono) =>
  app.request("/work", {
    method: "POST",
    headers: { "payment-signature": payload },
  });

describe("settle-failure alerts in seam", () => {
  it("settle fail → alertSettleFailure fired with reason+endpoint", async () => {
    alertSpy.mockClear();
    const app = appWith(
      router({
        settle: async () => ({
          success: false,
          errorReason: "insufficient_funds",
        }),
      }),
    );
    const res = await post(app);
    expect(res.status).toBe(402);
    // alert is fire-and-forget — give the void-promise a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]![0]).toMatchObject({
      reason: "insufficient_funds",
      endpoint: "/api/total-scan",
      payer: PAYER,
    });
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
  });

  it("verify fail → NO alert", async () => {
    alertSpy.mockClear();
    const app = appWith(
      router({
        verify: async () => ({ isValid: false, invalidReason: "bad sig" }),
      }),
    );
    const res = await post(app);
    expect(res.status).toBe(402);
    await new Promise((r) => setTimeout(r, 10));
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
