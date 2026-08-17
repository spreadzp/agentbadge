/**
 * Payment routes — Stripe fiat payment integration.
 *
 * SLICE-67-1: Placeholder router. Endpoints will be added in subsequent slices:
 * - SLICE-67-3: POST /api/payment/checkout
 * - SLICE-67-4: POST /api/stripe/webhook
 * - SLICE-67-5: GET /payment/success, GET /payment/canceled
 */

import { Hono } from "hono";

import { getStripeClient, isStripeConfigured } from "../lib/stripe-client";
import { listFiatProducts, getFiatProduct } from "../lib/pricing";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

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
