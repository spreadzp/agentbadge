/**
 * Payment routes — Stripe fiat payment integration.
 *
 * SLICE-67-1: Placeholder router. Endpoints will be added in subsequent slices:
 * - SLICE-67-3: POST /api/payment/checkout
 * - SLICE-67-4: POST /api/stripe/webhook
 * - SLICE-67-5: GET /payment/success, GET /payment/canceled
 */

import { Hono } from "hono";
import type Stripe from "stripe";

import { getStripeClient, isStripeConfigured } from "../lib/stripe-client";
import { listFiatProducts, getFiatProduct } from "../lib/pricing";
import { fulfillOrder } from "../lib/order-fulfillment";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { captureError } from "../lib/sentry";
import { renderPaymentSuccess, renderPaymentError } from "../../views/payment-success";
import { renderPaymentCanceled } from "../../views/payment-canceled";

export const paymentRoutes = new Hono();

paymentRoutes.get("/api/payment/products", (c) => {
    return c.json({ products: listFiatProducts() });
});

interface CheckoutRequest {
    productId: string;
    email?: string;
    metadata?: Record<string, string>;
}

paymentRoutes.post("/api/payment/checkout", async (c) => {
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
                ...product.metadata,
                ...metadata,
                productId,
            },
        });

        return c.json({ url: session.url, sessionId: session.id });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown Stripe error";
        return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, `Stripe checkout failed: ${message}`);
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
        const message = err instanceof Error ? err.message : "Unknown error";
        return c.json({ error: `Webhook signature verification failed: ${message}` }, 400);
    }

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            try {
                await fulfillOrder(session);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                console.error(`[webhook] Fulfillment failed for session ${session.id}:`, message);
                captureError(err, { sessionId: session.id, eventType: event.type });
                return c.json({ error: "Fulfillment failed" }, 500);
            }
            break;
        }
        default:
            break;
    }

    return c.json({ received: true });
});

paymentRoutes.get("/payment/success", async (c) => {
    const sessionId = c.req.query("session_id");
    if (!sessionId) {
        return c.html(renderPaymentError("Missing Session ID", "No session_id parameter was provided."));
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
