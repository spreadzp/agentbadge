/**
 * Payments API routes — POST/GET /api/v1/payments*
 * (EPIC-221, SLICE-221-2, D-221-1/D-221-6/D-221-8).
 *
 * Checkout flow: create a PENDING payment bound to a catalog product
 * (metadata validated BEFORE create), then attach rail attempts
 * (STRIPE checkout session or DIRECT_USDC instructions). Recipient and
 * tokenContract for USDC instructions come ONLY from server config —
 * client-supplied rail fields are rejected outright.
 *
 * Factory pattern: `createPaymentsApiRoutes(getCheckout)` keeps the
 * service injectable for tests; `paymentsApiRoutes` resolves the lazy
 * production singleton per request.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  attemptJson,
  createAttemptSchema,
  createPaymentSchema,
  paymentJson,
} from "../lib/payments-api/api-schemas";
import {
  CheckoutError,
  getPaymentsCheckout,
  type PaymentsCheckout,
} from "../lib/payments-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>;

async function parseJson(c: Context): Promise<JsonBody | null> {
  try {
    const body = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as JsonBody)
      : null;
  } catch {
    return null;
  }
}

function checkoutError(c: Context, err: unknown): Response {
  if (err instanceof CheckoutError) {
    return errorResponse(c, err.status, err.code as never, err.message, {
      hint:
        err.details === undefined
          ? undefined
          : Array.isArray(err.details)
            ? err.details.join("; ")
            : JSON.stringify(err.details),
    });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createPaymentsApiRoutes(
  getCheckout: () => PaymentsCheckout,
): Hono {
  const routes = new Hono();

  routes.post(
    "/api/v1/payments",
    describeRoute({
      tags: ["Payments"],
      summary: "Create a checkout payment",
      description:
        "Creates a PENDING payment for a catalog product. `metadata` is " +
        "validated against the product's declared metadataSchema BEFORE " +
        "the payment row exists — no 'paid but no fulfillment data' " +
        "state. `amount` is a decimal string (catalog USD price × " +
        "quantity, integer-cents math). Idempotent via Idempotency-Key " +
        "header. Attach a rail with POST /api/v1/payments/:id/attempts.",
      responses: {
        201: {
          description: "Payment created (or deduped)",
          content: {
            "application/json": { schema: resolver(paymentJson) },
          },
        },
        400: { description: "Invalid metadata / product / quantity" },
      },
    }),
    async (c) => {
      const body = await parseJson(c);
      if (!body) {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON body");
      }
      const parsed = createPaymentSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.MISSING_FIELDS,
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      }
      try {
        const { payment, deduped } = await getCheckout().createPayment({
          productCode: parsed.data.productCode,
          quantity: parsed.data.quantity,
          metadata: parsed.data.metadata,
          customerId: parsed.data.customerId,
          agentId: parsed.data.agentId,
          idempotencyKey: c.req.header("Idempotency-Key") ?? undefined,
        });
        const payload =
          typeof payment.payload === "object" && payment.payload !== null
            ? (payment.payload as { productCode?: string })
            : {};
        return c.json(
          {
            payment: {
              id: payment.id,
              reference: payment.reference,
              status: payment.status,
              amount: payment.amount,
              currency: "USD",
              productCode: payload.productCode,
            },
            deduped,
          },
          201,
        );
      } catch (err) {
        return checkoutError(c, err);
      }
    },
  );

  routes.post(
    "/api/v1/payments/:id/attempts",
    describeRoute({
      tags: ["Payments"],
      summary: "Attach a payment rail attempt",
      description:
        "Binds STRIPE (Checkout Session — returns redirectUrl) or " +
        "DIRECT_USDC (self-serve paymentInstructions) to an existing " +
        "PENDING/PROCESSING payment. `network` applies to USDC only " +
        "(eip155:* Arc/Base, solana). Recipient and tokenContract are " +
        "server-configured and cannot be supplied by the client.",
      responses: {
        201: {
          description: "Attempt submitted to the rail",
          content: {
            "application/json": { schema: resolver(attemptJson) },
          },
        },
        400: { description: "Invalid provider/network or forbidden field" },
        404: { description: "Payment not found" },
        409: { description: "Payment not payable (terminal status)" },
      },
    }),
    async (c) => {
      const body = await parseJson(c);
      if (!body) {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON body");
      }
      // Spec invariant — reject client-supplied rail fields outright.
      for (const field of ["recipient", "tokenContract", "token"]) {
        if (field in body) {
          return errorResponse(
            c,
            400,
            ErrorCodes.CHECKOUT_FORBIDDEN_FIELD,
            `${field} is server-configured — do not send it`,
          );
        }
      }
      const parsed = createAttemptSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.MISSING_FIELDS,
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      }
      try {
        const result = await getCheckout().createAttempt({
          paymentId: c.req.param("id"),
          provider: parsed.data.provider,
          network: parsed.data.network,
        });
        const meta = result.providerMetadata ?? {};
        const out: Record<string, unknown> = {
          attempt: {
            id: result.attempt.id,
            paymentId: result.attempt.paymentId,
            provider: result.attempt.provider,
            status: result.attempt.status,
            network: result.attempt.network,
            expiresAt: result.attempt.expiresAt?.toISOString(),
          },
          payment: { status: result.payment.status },
        };
        if (typeof meta.checkoutUrl === "string") {
          out.redirectUrl = meta.checkoutUrl;
        }
        if (meta.paymentInstructions !== undefined) {
          out.paymentInstructions = meta.paymentInstructions;
        }
        return c.json(out, 201);
      } catch (err) {
        return checkoutError(c, err);
      }
    },
  );

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
      return c.json({
        payment,
        attempts,
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
      return c.json({ receipt });
    },
  );

  return routes;
}

/** Production router — resolves the lazy singleton per request so env
 *  and DB wiring initialize on first use, not at import time. */
export const paymentsApiRoutes = createPaymentsApiRoutes(getPaymentsCheckout);
