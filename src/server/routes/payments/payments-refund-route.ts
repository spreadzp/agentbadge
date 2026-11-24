/**
 * SLICE-222-6 — admin refund route (extracted from
 * payments-api.ts, file-size lint cap).
 *
 * POST /api/v1/payments/:id/refund — ops-only (operatorAuth, workflow cap): the
 * on-chain refund SEND is manual (D-222-6); this endpoint records
 * it — REFUND_REQUEST exception → markRefunded → REFUNDED + audit.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { pickOperatorStores, type OperatorStore } from "../../lib/operators";
import { getDatabase } from "../../lib/database";
import { operatorAuth, principalId } from "../../middleware/operatorAuth";
import {
  capabilityGate,
  lazyOperatorAuth,
} from "../../middleware/operator-gate";
import { rejectOperatorField } from "../finops/helpers";
import type { PaymentsCheckout } from "../../lib/payments-api";

export function createPaymentsRefundRoutes(
  getCheckout: () => PaymentsCheckout,
  operatorStore?: OperatorStore,
): Hono {
  const routes = new Hono();
  // 264-8: payments-api is an import-time singleton — resolve the
  // shared store on first request, not at module load.
  const auth = operatorStore
    ? operatorAuth(operatorStore)
    : lazyOperatorAuth(() => pickOperatorStores(getDatabase()));

  routes.post(
    "/api/v1/payments/:id/refund",
    describeRoute({
      tags: ["Payments"],
      summary: "Mark a payment refunded (admin)",
      description:
        "Records an ops-executed on-chain refund: appends a " +
        "REFUND_REQUEST exception, transitions the payment " +
        "CONFIRMED → REFUNDED, resolves the exception. Requires an " +
        "operator credential (X-Admin-Key or Bearer opk_). `txHash` " +
        "must be the refund transaction hash (0x + 64 hex).",
      responses: {
        200: { description: "Payment marked REFUNDED" },
        400: { description: "Missing/invalid txHash" },
        401: { description: "Missing/invalid operator credential" },
        404: { description: "Unknown payment" },
        409: {
          description: "Payment not CONFIRMED / already refunded",
        },
      },
    }),
    auth,
    capabilityGate(),
    async (c: Context) => {
      const body = await c.req.json().catch(() => null);
      if (body === null || typeof body !== "object") {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_JSON,
          "invalid JSON body",
        );
      }
      const b = body as Record<string, unknown>;
      const opf = rejectOperatorField(b, ["refundedBy"]);
      if (opf && !opf.ok) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          opf.error.message,
        );
      }
      const txHash = typeof b.txHash === "string" ? b.txHash : "";
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "txHash must be a 0x-prefixed 32-byte hash",
        );
      }
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const note =
        typeof b.note === "string" ? b.note : undefined;
      const paymentId = c.req.param("id");
      if (!paymentId) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "missing payment id",
        );
      }
      const res = await getCheckout().refundPaymentOps({
        paymentId,
        txHash,
        refundedBy: actor,
        ...(note !== undefined ? { note } : {}),
      });
      if (res.status !== "REFUNDED") {
        const notFound = res.reason?.includes("unknown payment");
        return errorResponse(
          c,
          notFound ? 404 : 409,
          notFound
            ? ErrorCodes.PAYMENT_NOT_FOUND
            : ErrorCodes.INVALID_INPUT,
          res.reason ?? "refund rejected",
        );
      }
      return c.json({
        payment: {
          id: paymentId,
          status: "REFUNDED",
          refundTxHash: txHash,
          refundedBy: actor,
        },
      });
    },
  );

  return routes;
}
