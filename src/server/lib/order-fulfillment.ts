/**
 * Order fulfillment dispatcher (SLICE-221-3, D-221-4/D-221-9).
 *
 * Handlers now take the normalized FulfillmentInput — never a raw
 * Stripe session. `fulfillOrder(session)` is the legacy adapter: it
 * normalizes the session and routes through the same fulfillment
 * registry as the new payments path.
 *
 * Exactly-once: processedSessions guards legacy redelivery; the
 * registry dedupeKey guards the new confirm path.
 */

import type Stripe from "stripe";
import type { Tier, Capability } from "@agentbadge/hedera-core";
import { issuePassport } from "@agentbadge/passport";
import { logger } from "@agentbadge/passport/logger";
import { passportChainEnabled } from "./passport-chain-gate";
import { sendDiscordMessage } from "../services/contact.service";
import {
  dispatchFulfillment,
  registerFulfillmentHandler,
  setFulfillmentNotifier,
  type FulfillmentHandler,
  type FulfillmentInput,
} from "./payments-api/fulfillment";

const processedSessions = new Set<string>();

export function resetProcessedSessions(): void {
  processedSessions.clear();
}

// ---------------------------------------------------------------------------
// Normalized handlers (D-221-4)
// ---------------------------------------------------------------------------

export async function fulfillDirectoryListing(
  input: FulfillmentInput,
): Promise<void> {
  const listingId = input.metadata.listingId;
  if (!listingId) {
    logger.error("fulfillDirectoryListing: missing listingId in metadata", {
      paymentRef: input.paymentRef,
    });
    return;
  }

  logger.info("fulfillDirectoryListing: listing published", {
    listingId,
    paymentRef: input.paymentRef,
  });

  if (input.email) {
    logger.info("fulfillDirectoryListing: confirmation email queued", {
      email: input.email,
    });
  }
}

/** Parse helper — catalog metadata stores arrays natively; legacy Stripe
 *  session metadata is strings-only (JSON-encoded). */
function parseMetaList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== "string" || !v) return undefined;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

export async function fulfillPassportMint(
  input: FulfillmentInput,
): Promise<void> {
  if (!passportChainEnabled()) {
    logger.error(
      "fulfillPassportMint: PASSPORT_CHAIN_ENABLED is off, mint skipped",
      { paymentRef: input.paymentRef },
    );
    return;
  }

  const m = input.metadata;
  const tier = m.tier as Tier;
  const name = (m.name as string) ?? "Stripe-paid agent";
  const accountId = m.accountId as string;
  const capabilities = (parseMetaList(m.capabilities) ?? []) as Capability[];
  const endpoint = m.endpoint as string | undefined;
  const skills = parseMetaList(m.skills);
  const imageUrl = m.imageUrl as string | undefined;

  if (!tier || !accountId) {
    logger.error(
      "fulfillPassportMint: missing required metadata (tier or accountId)",
      { paymentRef: input.paymentRef },
    );
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

  logger.info("fulfillPassportMint: passport minted", {
    tokenId: result.tokenId,
    serialNumber: result.serialNumber,
    paymentRef: input.paymentRef,
  });
}

// Registry wiring — kind keys come from catalog fulfillmentKind values.
/** Registers the built-in handlers + Discord notifier on the default
 *  registry. Exported so tests can restore it after
 *  resetFulfillmentRegistry(). */
export function registerDefaultFulfillmentHandlers(): void {
  registerFulfillmentHandler("passport-mint", fulfillPassportMint);
  registerFulfillmentHandler("directory-listing", fulfillDirectoryListing);
  setFulfillmentNotifier(notifyPaymentDiscord);
}

registerDefaultFulfillmentHandlers();

// ---------------------------------------------------------------------------
// Legacy adapter (D-221-9)
// ---------------------------------------------------------------------------

/** Stripe session → normalized input. kind comes from the legacy
 *  productId mapping — same dispatch as the new catalog path. */
export function normalizeSession(
  session: Pick<
    Stripe.Checkout.Session,
    "id" | "metadata" | "customer_details" | "customer_email" | "amount_total"
  >,
): FulfillmentInput & { kind?: string } {
  const productId = session.metadata?.productId;
  const kind =
    productId === "directory-listing"
      ? "directory-listing"
      : productId?.startsWith("passport-")
        ? "passport-mint"
        : undefined;
  const email =
    session.customer_details?.email ?? session.customer_email ?? undefined;
  return {
    productCode: productId ?? "unknown",
    kind,
    buyerRef: email,
    metadata: (session.metadata ?? {}) as Record<string, unknown>,
    email,
    amountUsd: session.amount_total
      ? (session.amount_total / 100).toFixed(2)
      : undefined,
    paymentRef: session.id,
  };
}

export async function fulfillOrder(
  session: Stripe.Checkout.Session,
  opts?: { registry?: Map<string, FulfillmentHandler> },
): Promise<void> {
  if (processedSessions.has(session.id)) {
    logger.info("fulfillOrder: session already processed, skipping", {
      sessionId: session.id,
    });
    return;
  }

  const input = normalizeSession(session);
  if (input.productCode === "unknown") {
    logger.error("fulfillOrder: no productId in session metadata", {
      sessionId: session.id,
    });
    return;
  }

  const dispatched = await dispatchFulfillment(input, {
    kind: input.kind,
    dedupeKey: `session:${session.id}`,
    registry: opts?.registry,
  });
  // H-6: a paid session with no handler is an incident, not a skip.
  if (dispatched === "no-handler") {
    logger.error("fulfillOrder: no fulfillment handler for productId", {
      productId: input.productCode,
      kind: input.kind,
      sessionId: session.id,
    });
  }
  processedSessions.add(session.id);
}

/** M-8: attacker-controlled metadata reaches Discord — strip mentions,
 *  markdown control chars and newlines, and cap field length. */
function sanitizeField(v: unknown, maxLen = 100): string {
  if (typeof v !== "string") return "unknown";
  return v
    .slice(0, maxLen)
    .replace(/[\r\n]+/g, " ")
    .replace(/[@#*_~`|]/g, "")
    .trim() || "unknown";
}

async function notifyPaymentDiscord(input: FulfillmentInput): Promise<void> {
  const email = sanitizeField(input.email ?? input.buyerRef);
  const amount = input.amountUsd
    ? `$${sanitizeField(input.amountUsd, 20)}`
    : "unknown";
  const message = [
    `💳 New Payment Received`,
    `Product: ${sanitizeField(input.productCode, 64)}`,
    `Amount: ${amount}`,
    `Email: ${email}`,
    `Session: ${sanitizeField(input.paymentRef)}`,
  ].join("\n");

  try {
    await sendDiscordMessage({ message });
    logger.info("fulfillOrder: Discord notification sent", {
      paymentRef: input.paymentRef,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("fulfillOrder: Discord notification failed", { error: msg });
  }
}
