/**
 * Payment routes — Stripe fiat payment integration.
 *
 * SLICE-67-1: Placeholder router. Endpoints will be added in subsequent slices:
 * - SLICE-67-3: POST /api/payment/checkout
 * - SLICE-67-4: POST /api/stripe/webhook
 * - SLICE-67-5: GET /payment/success, GET /payment/canceled
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type Stripe from "stripe";

import { getStripeClient, isStripeConfigured } from "../lib/stripe-client";
import { listFiatProducts, getFiatProduct } from "../lib/pricing";
import { dispatchCheckoutSession } from "../lib/payments-api/webhook-dispatch";
import { makeStripeWebhookDispatch } from "../lib/payments-api";
import { EventLedger, withIdempotency } from "../lib/event-ledger";
import { clientSafeMetadata } from "../lib/payments-api/legacy-metadata";
import { legacyEndpointDeprecation } from "../lib/contract-guards";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { captureError } from "../lib/sentry";
import { logger } from "@agentbadge/passport/logger";
import { checkoutResponseSchema, errorSchema } from "../openapi";
import { renderPaymentSuccess, renderPaymentError } from "../../views/payment-success";
import { renderPaymentCanceled } from "../../views/payment-canceled";

const webhookLedger = new EventLedger();

const fiatProductListSchema = z.object({
    products: z.array(
        z.object({
            productId: z.string(),
            name: z.string(),
            description: z.string(),
            amountUsd: z.number(),
            amountCents: z.number(),
            metadata: z.record(z.string(), z.string()),
        }),
    ),
});

export const paymentRoutes = new Hono();

// SLICE-221-5 (D-221-5): legacy checkout surface is soft-deprecated in favour
// of /api/v1/payments* + /checkout — headers on ALL methods, incl. error
// responses. /api/stripe/webhook stays current (serves both flows).
paymentRoutes.use(
  "/api/payment/*",
  legacyEndpointDeprecation("/api/v1/payments"),
);
paymentRoutes.use("/payment/*", legacyEndpointDeprecation("/checkout"));

paymentRoutes.get(
    "/api/payment/products",
    describeRoute({
        tags: ["Payment"],
        deprecated: true,
        summary: "List available fiat products",
        description: "Returns all products available for Stripe Checkout purchase.",
        responses: {
            200: {
                description: "List of fiat products",
                content: {
                    "application/json": {
                        schema: resolver(fiatProductListSchema),
                    },
                },
            },
        },
    }),
    (c) => {
        return c.json({ products: listFiatProducts() });
    },
);

interface CheckoutRequest {
    productId: string;
    email?: string;
    metadata?: Record<string, string>;
}

paymentRoutes.post(
    "/api/payment/checkout",
    describeRoute({
        tags: ["Payment"],
        deprecated: true,
        summary: "Create a Stripe Checkout Session",
        description:
            "Creates a Stripe Checkout Session for one-time fiat payment and returns the redirect URL. For passport products, include accountId in metadata for NFT minting.",
        responses: {
            200: {
                description: "Checkout session created",
                content: {
                    "application/json": { schema: resolver(checkoutResponseSchema) },
                },
            },
            400: {
                description: "Invalid product ID or missing fields",
                content: {
                    "application/json": { schema: resolver(errorSchema) },
                },
            },
            500: {
                description: "Stripe API error or Stripe not configured",
                content: {
                    "application/json": { schema: resolver(errorSchema) },
                },
            },
        },
    }),
    async (c) => {
        if (!isStripeConfigured()) {
            return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, "Stripe is not configured");
        }

        let body: CheckoutRequest;
        try {
            body = await c.req.json();
        } catch {
            return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
        }

        const { productId, email, metadata } = body;
        if (!productId) {
            return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing productId");
        }

        const product = getFiatProduct(productId);
        if (!product) {
            return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, `Unknown product: ${productId}`);
        }

        const stripe = getStripeClient();
        const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:4021";

        try {
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ["card"],
                line_items: [
                    {
                        price_data: {
                            currency: "usd",
                            product_data: {
                                name: product.name,
                                description: product.description,
                            },
                            unit_amount: product.amountCents,
                        },
                        quantity: 1,
                    },
                ],
                mode: "payment",
                customer_email: email,
                success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${baseUrl}/payment/canceled`,
                metadata: {
                    // Server values last — client metadata can never
                    // override product/rail binding keys (H-1).
                    ...clientSafeMetadata(metadata),
                    ...product.metadata,
                    productId,
                },
            });

            return c.json({ url: session.url, sessionId: session.id });
        } catch (err) {
            // M-4: Stripe error text can leak internals — log, don't echo.
            logger.error("legacy checkout: stripe session create failed", {
                error: err instanceof Error ? err.message : String(err),
            });
            return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, "Stripe checkout failed");
        }
    });

paymentRoutes.post("/api/stripe/webhook", async (c) => {
    if (!isStripeConfigured()) {
        return c.json({ error: "Stripe is not configured" }, 500);
    }

    const signature = c.req.header("stripe-signature");
    if (!signature) {
        return c.json({ error: "Missing stripe-signature header" }, 400);
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        return c.json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
    }

    const rawBody = await c.req.text();
    const stripe = getStripeClient();

    let event: Stripe.Event;
    try {
        event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
    } catch (err) {
        // M-4: do not echo verification internals to the caller.
        logger.warn("stripe webhook: signature verification failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        return c.json({ error: "Webhook signature verification failed" }, 400);
    }

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const result = await withIdempotency(
                webhookLedger,
                event.id,
                session.id,
                async () => {
                    const dispatched = await dispatchCheckoutSession(
                        session,
                        makeStripeWebhookDispatch(),
                    );
                    // H-6: non-fulfilling states surface as 5xx so Stripe
                    // retries the delivery instead of silently acking.
                    if (dispatched.error) {
                        throw new Error(dispatched.error);
                    }
                },
                {
                    onAlert: (info) => {
                        logger.error("webhook: repeated failures", { attempts: info.attempts, eventId: info.eventId, lastError: info.lastError });
                        captureError(new Error(`Webhook repeated failures: ${info.eventId}`), {
                            eventId: info.eventId,
                            sessionId: info.sessionId,
                            attempts: info.attempts,
                        });
                    },
                },
            );
            if (result.fulfilled) {
                return c.json({ received: true });
            }
            if (result.deduped) {
                return c.json({ received: true, deduped: true });
            }
            // Fulfillment failed
            captureError(new Error(result.error), { sessionId: session.id, eventType: event.type });
            return c.json({ error: "Fulfillment failed" }, 500);
        }
        default:
            break;
    }

    return c.json({ received: true });
});

// M-7: session ids are `cs_(test|live)_…` — anything else is not a
// session and never reaches Stripe or the template.
const STRIPE_SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;

paymentRoutes.get("/payment/success", async (c) => {
    const sessionId = c.req.query("session_id");
    if (!sessionId) {
        return c.html(renderPaymentError("Missing Session ID", "No session_id parameter was provided."));
    }
    if (!STRIPE_SESSION_ID_RE.test(sessionId)) {
        return c.html(renderPaymentError("Invalid Session ID", "The session_id parameter is not a valid checkout session."));
    }

    if (!isStripeConfigured()) {
        return c.html(renderPaymentSuccess({ id: sessionId, status: "open" }, true));
    }

    try {
        const stripe = getStripeClient();
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        return c.html(renderPaymentSuccess(session, false));
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return c.html(renderPaymentError("Could not retrieve session", `Session ID: ${sessionId}. ${message}`));
    }
});

paymentRoutes.get("/payment/canceled", (c) => {
    return c.html(renderPaymentCanceled());
});
