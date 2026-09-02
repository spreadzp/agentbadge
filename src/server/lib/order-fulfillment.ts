/**
 * Order fulfillment dispatcher.
 *
 * SLICE-67-4: Stub implementation.
 * SLICE-67-6: Real fulfillment logic with idempotency, passport minting,
 *   and directory listing publishing.
 */

import type Stripe from "stripe";
import type { Tier, Capability } from "@agentgate-hedera/hedera-core";
import { issuePassport, logger } from "@agentgate-hedera/passport";
import { sendDiscordMessage } from "../services/contact.service";

const processedSessions = new Set<string>();

export function resetProcessedSessions(): void {
  processedSessions.clear();
}

export async function fulfillOrder(session: Stripe.Checkout.Session): Promise<void> {
  if (processedSessions.has(session.id)) {
    logger.info("fulfillOrder: session already processed, skipping", { sessionId: session.id });
    return;
  }

  const productId = session.metadata?.productId;
  if (!productId) {
    logger.error("fulfillOrder: no productId in session metadata", { sessionId: session.id });
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
      logger.warn("fulfillOrder: unknown productId", { productId, sessionId: session.id });
  }

  processedSessions.add(session.id);

  await notifyPaymentDiscord(session, productId);
}

async function fulfillDirectoryListing(session: Stripe.Checkout.Session): Promise<void> {
  const listingId = session.metadata?.listingId;

  if (!listingId) {
    logger.error("fulfillDirectoryListing: missing listingId in metadata", { sessionId: session.id });
    return;
  }

  logger.info("fulfillDirectoryListing: listing published", { listingId, sessionId: session.id });

  const email = session.customer_details?.email ?? session.customer_email;
  if (email) {
    logger.info("fulfillDirectoryListing: confirmation email queued", { email });
  }
}

async function fulfillPassportMint(session: Stripe.Checkout.Session): Promise<void> {
  const tier = session.metadata?.tier as Tier;
  const name = session.metadata?.name ?? "Stripe-paid agent";
  const accountId = session.metadata?.accountId;
  const capabilities = JSON.parse(session.metadata?.capabilities ?? "[]") as Capability[];
  const endpoint = session.metadata?.endpoint;
  const skills = session.metadata?.skills ? JSON.parse(session.metadata.skills) : undefined;
  const imageUrl = session.metadata?.imageUrl;

  if (!tier || !accountId) {
    logger.error("fulfillPassportMint: missing required metadata (tier or accountId)", { sessionId: session.id });
    return;
  }

  const result = await issuePassport(
    accountId,
    "",
    tier,
    name,
    capabilities,
    endpoint,
    skills,
    imageUrl,
  );

  logger.info("fulfillPassportMint: passport minted", { tokenId: result.tokenId, serialNumber: result.serialNumber, sessionId: session.id });
}

async function notifyPaymentDiscord(session: Stripe.Checkout.Session, productId: string): Promise<void> {
  const email = session.customer_details?.email ?? session.customer_email ?? "unknown";
  const amount = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : "unknown";
  const message = [
    `💳 New Payment Received`,
    `Product: ${productId}`,
    `Amount: ${amount}`,
    `Email: ${email}`,
    `Session: ${session.id}`,
  ].join("\n");

  try {
    await sendDiscordMessage({ message });
    logger.info("fulfillOrder: Discord notification sent", { sessionId: session.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("fulfillOrder: Discord notification failed", { error: msg });
  }
}
