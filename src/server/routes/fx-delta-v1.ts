/**
 * SLICE-223-6: fx-delta premium v1 pilot — Arc x402 gateway.
 *
 * GET /api/v1/fx/delta/premium serves the SAME snapshot payload as
 * /api/fx-delta/premium, but payment runs through the new gateway
 * middleware (seeded resource "fx-delta-premium", D-223-4) instead of
 * the Celo facilitator gate. The legacy route is untouched.
 */

import { Hono } from "hono";

import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { getFxDeltaRuntime } from "../lib/fx-delta";
import { X402_PAYMENT_KEY } from "../lib/x402-gateway";
import type { SettleSeamResult } from "../lib/x402-settle-seam";
import { viewJson } from "./fx-delta-api";

export const fxDeltaV1Routes = new Hono<{
  Variables: { [X402_PAYMENT_KEY]: SettleSeamResult };
}>();

fxDeltaV1Routes.get("/api/v1/fx/delta/premium", (c) => {
  const rt = getFxDeltaRuntime();
  if (!rt) {
    return errorResponse(
      c,
      503,
      ErrorCodes.INTERNAL_ERROR,
      "engine not started",
    );
  }
  const snap = rt.engine.getAll();
  const payment = c.get(X402_PAYMENT_KEY);
  return c.json({
    v: 1,
    corridors: snap.map(viewJson),
    events: rt.engine.getEvents().slice(-200),
    history: Object.fromEntries(
      snap.map((v) => [v.corridor, rt.engine.getHistory(v.corridor)]),
    ),
    atMs: Date.now(),
    // D-223-7: receipt in body alongside the PAYMENT-RESPONSE header.
    payment: {
      txHash: payment.tx ?? null,
      network: payment.sourceChain ?? null,
      amount: payment.amountAtomic,
      receiptId: payment.tx ?? null,
    },
  });
});
