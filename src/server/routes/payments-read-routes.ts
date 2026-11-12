/**
 * Payments API read routes — GET /api/v1/payments/:id and
 * /:id/receipt (extracted from payments-api.ts, file-size lint cap).
 *
 * M-4: both endpoints return an explicit public projection — payload /
 * persistence internals (metadata, customer/agent ids, provider refs,
 * raw verificationData) never reach the read surface.
 */
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { paymentJson } from "../lib/payments-api/api-schemas";
import type { PaymentsCheckout } from "../lib/payments-api";

export function createPaymentsReadRoutes(
  getCheckout: () => PaymentsCheckout,
): Hono {
  const routes = new Hono();

  routes.get(
    "/api/v1/payments/:id",
    describeRoute({
      tags: ["Payments"],
      summary: "Get payment status",
      description:
        "Payment status polling — returns the payment plus its attempts. " +
        "Lazy expiry applies: overdue non-terminal rows transition to " +
        "EXPIRED on read.",
      responses: {
        200: {
          description: "Payment + attempts",
          content: {
            "application/json": { schema: resolver(paymentJson) },
          },
        },
        404: { description: "Payment not found" },
      },
    }),
    async (c) => {
      const checkout = getCheckout();
      const payment = await checkout.getPayment(c.req.param("id"));
      if (!payment) {
        return errorResponse(
          c,
          404,
          ErrorCodes.PAYMENT_NOT_FOUND,
          "payment not found",
        );
      }
      const attempts = await checkout.listAttempts(payment.id);
      // M-4: explicit projection — payload/persistence fields (metadata,
      // customer/agent ids, provider refs, internal payload) stay out of
      // the public read surface.
      return c.json({
        payment: {
          id: payment.id,
          reference: payment.reference,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          productCode: payment.productId,
        },
        attempts: attempts.map((a) => ({
          id: a.id,
          provider: a.provider,
          status: a.status,
          network: a.network,
          expiresAt: a.expiresAt?.toISOString(),
        })),
      });
    },
  );

  routes.get(
    "/api/v1/payments/:id/receipt",
    describeRoute({
      tags: ["Payments"],
      summary: "Get verified payment receipt",
      description:
        "Returns the latest receipt for the payment — present only " +
        "after a CONFIRMED attempt (self-heal confirm or webhook).",
      responses: {
        200: { description: "Verified receipt" },
        404: { description: "No receipt — payment unconfirmed or unknown" },
      },
    }),
    async (c) => {
      const checkout = getCheckout();
      const receipt = await checkout.getReceipt(c.req.param("id"));
      if (!receipt) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RECEIPT_NOT_FOUND,
          "receipt not found — payment is not confirmed",
        );
      }
      // M-4: project the receipt — `verificationData` is raw provider
      // internals and never belongs on the public surface.
      return c.json({
        receipt: {
          id: receipt.id,
          paymentId: receipt.paymentId,
          attemptId: receipt.attemptId,
          provider: receipt.provider,
          externalReference: receipt.externalReference,
          network: receipt.network,
          transactionHash: receipt.transactionHash,
          payer: receipt.payer,
          recipient: receipt.recipient,
          amount: receipt.amount,
          asset: receipt.asset,
          verifiedAt: new Date(receipt.verifiedAtMs).toISOString(),
        },
      });
    },
  );

  return routes;
}
