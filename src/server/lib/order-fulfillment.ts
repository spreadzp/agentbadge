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
import { notifyPaymentDiscord } from "./order-fulfillment-notify";
import {
  dispatchFulfillment,
  registerFulfillmentHandler,
  setFulfillmentNotifier,
  type FulfillmentEffectContext,
  type FulfillmentHandler,
  type FulfillmentInput,
  type FulfillmentOutcome,
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
): Promise<FulfillmentOutcome> {
  const listingId = input.metadata.listingId;
  if (!listingId) {
    logger.error("fulfillDirectoryListing: missing listingId in metadata", {
      paymentRef: input.paymentRef,
    });
    return "needs-ops";
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
  return "executed";
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
  ctx?: FulfillmentEffectContext,
): Promise<FulfillmentOutcome> {
  if (!passportChainEnabled()) {
    // C-1: the mint is gated OFF — a paid payment cannot be
    // delivered by this path; dispatch must NOT record done.
    logger.error(
      "fulfillPassportMint: PASSPORT_CHAIN_ENABLED is off, mint skipped",
      { paymentRef: input.paymentRef },
    );
    return "needs-ops";
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
    return "needs-ops";
  }

  // Reviews 6.1/6.2 (EPIC-222): the mint is an external effect — before
  // running it, consult the durable effect ledger. "done" → dedupe (a
  // crashed run already minted); "intent" → an effect may be in flight
  // or was interrupted mid-mint — never blind re-mint, flag for ops.
  if (ctx) {
    const prior = await ctx.priorEffect();
    if (prior.status === "done") {
      logger.info("fulfillPassportMint: prior mint deduped by operationId", {
        paymentRef: input.paymentRef,
        priorResult: prior.result,
      });
      return "deduped-done";
    }
    if (prior.status === "intent") {
      // C-1: ambiguous — the mint may have executed without a done
      // marker. Never report success; ops reconciles.
      logger.error(
        "fulfillPassportMint: unresolved effect-intent — mint may have " +
        "run already; NOT re-minting, ops must reconcile",
        { paymentRef: input.paymentRef },
      );
      return "needs-ops";
    }
    if (!(await ctx.markIntent())) {
      logger.info("fulfillPassportMint: effect already claimed", {
        paymentRef: input.paymentRef,
      });
      return "deduped";
    }
  }

  let result: Awaited<ReturnType<typeof issuePassport>>;
  try {
    result = await issuePassport(
      accountId,
      "",
      tier,
      name,
      capabilities,
      endpoint,
      skills,
      imageUrl,
    );
  } catch (err) {
    // C-1: the throw happened on the mint call itself — record
    // effect-failed so the intent is superseded and a retry is a
    // clean first run, not an ambiguous "intent".
    await ctx?.markFailed(
      err instanceof Error ? err.message.slice(0, 300) : String(err),
    );
    throw err;
  }

  await ctx?.markDone({
    tokenId: result.tokenId,
    serialNumber: result.serialNumber,
  });

  logger.info("fulfillPassportMint: passport minted", {
    tokenId: result.tokenId,
    serialNumber: result.serialNumber,
    paymentRef: input.paymentRef,
  });
  return "executed";
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
