/**
 * SLICE-49-18: MPP + SPT payment middleware
 *
 * Adds WWW-Authenticate: Payment headers to 402 responses
 * for AgentGrade "MPP" and "SPT (Stripe)" check compliance.
 *
 * Works alongside existing x402 Payment-Required middleware.
 * When no valid payment is provided, returns 402 with:
 * - Payment-Required header (base64 JSON, x402 v1/v2 compat)
 * - WWW-Authenticate: Payment method="tempo" (MPP)
 * - WWW-Authenticate: Payment method="stripe" (SPT)
 * - JSON body with x402 challenge + bazaar extensions
 */

import type { MiddlewareHandler } from "hono";

export interface MppConfig {
  secretKey: string;
  recipientAddress: string;
  amount: string;
  stripeSecretKey?: string;
}

/**
 * Build a base64url-encoded SPT request for Stripe method.
 * Contains amount, currency, and recipient info.
 */
function buildStripeRequest(config: MppConfig): string {
  const payload = {
    amount: config.amount,
    currency: "usd",
    recipient: config.recipientAddress,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Build the x402 challenge JSON body.
 */
function buildX402Challenge(config: MppConfig) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "base",
        maxAmountRequired: config.amount,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: config.recipientAddress,
        maxTimeoutSeconds: 60,
      },
    ],
    extensions: {
      bazaar: {
        discoverable: true,
      },
    },
  };
}

/**
 * MPP + SPT payment middleware.
 *
 * Intercepts requests to paid endpoints. If no X-PAYMENT header is present,
 * returns 402 with WWW-Authenticate: Payment challenges for both tempo (MPP)
 * and stripe (SPT) methods, plus the x402 Payment-Required header.
 *
 * If X-PAYMENT header is present, passes through to the next handler
 * (actual payment verification is handled by the existing x402 middleware).
 */
export function mppPaymentMiddleware(config: MppConfig): MiddlewareHandler {
  return async (c, next) => {
    const paymentHeader = c.req.header("X-PAYMENT");

    if (paymentHeader) {
      await next();
      return;
    }

    const challenge = buildX402Challenge(config);
    const stripeRequest = buildStripeRequest(config);
    const paymentRequiredHeader = Buffer.from(
      JSON.stringify(challenge),
    ).toString("base64");

    const wwwAuthValues = [
      `Payment method="tempo", request="${paymentRequiredHeader}"`,
      `Payment method="stripe", request="${stripeRequest}"`,
    ];

    c.header("WWW-Authenticate", wwwAuthValues.join(", "));
    c.header("Payment-Required", paymentRequiredHeader);
    c.header("Content-Type", "application/json");

    return c.json(challenge, 402);
  };
}
