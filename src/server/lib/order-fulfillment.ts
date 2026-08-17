/**
 * Order fulfillment dispatcher.
 *
 * SLICE-67-4: Stub implementation. Real fulfillment logic
 * will be added in SLICE-67-6.
 */

import type Stripe from "stripe";

export async function fulfillOrder(session: Stripe.Checkout.Session): Promise<void> {
  const productId = session.metadata?.productId;
  if (!productId) {
    console.error("[fulfillOrder] No productId in session metadata", session.id);
    return;
  }

  switch (productId) {
    case "directory-listing":
      await fulfillDirectoryListing(session);
      break;
    case "passport-bronze":
    case "passport-silver":
    case "passport-gold":
    case "passport-platinum":
      await fulfillPassportMint(session);
      break;
    default:
      console.warn(`[fulfillOrder] Unknown productId: ${productId}`);
  }
}

async function fulfillDirectoryListing(session: Stripe.Checkout.Session): Promise<void> {
  console.log("[fulfillOrder] Directory listing fulfillment (stub)", session.id);
}

async function fulfillPassportMint(session: Stripe.Checkout.Session): Promise<void> {
  console.log("[fulfillOrder] Passport mint fulfillment (stub)", session.id);
}
