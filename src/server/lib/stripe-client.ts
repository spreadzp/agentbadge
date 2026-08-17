/**
 * Stripe client singleton.
 *
 * SLICE-67-1: Install Stripe SDK and create client configuration.
 *
 * Provides a lazily-initialized Stripe client and a helper to check
 * whether Stripe is configured (env var present).
 */

import Stripe from "stripe";

let stripeClient: Stripe | null = null;

/**
 * Returns true when STRIPE_SECRET_KEY is set to a non-empty value.
 */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Returns the singleton Stripe client.
 * Throws if STRIPE_SECRET_KEY is not set.
 */
export function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set");
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: "2025-06-30.basil" as Stripe.LatestApiVersion,
  });

  return stripeClient;
}
