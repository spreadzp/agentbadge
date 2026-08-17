/**
 * Payment routes — Stripe fiat payment integration.
 *
 * SLICE-67-1: Placeholder router. Endpoints will be added in subsequent slices:
 * - SLICE-67-3: POST /api/payment/checkout
 * - SLICE-67-4: POST /api/stripe/webhook
 * - SLICE-67-5: GET /payment/success, GET /payment/canceled
 */

import { Hono } from "hono";

import { listFiatProducts } from "../lib/pricing";

export const paymentRoutes = new Hono();

paymentRoutes.get("/api/payment/products", (c) => {
    return c.json({ products: listFiatProducts() });
});
