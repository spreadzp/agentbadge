/**
 * SLICE-153-5: venue billing routes — subscription + per-venue economics.
 *
 *   POST /api/venue/instances/:id/subscribe  — extend subscription (admin+)
 *   GET  /api/venue/instances/:id/economics  — venue take-rate resolution
 *   GET  /api/venue/instances/:id/billing    — subscription + payment ledger
 *
 * Payment seam (x402): `deps.subscriptionSettle` is the injected verifier —
 * production wiring settles the x402 payment and returns {payer, amount,
 * tx}; tests inject a mock. Without the dep the route accepts a direct
 * {amountAtomic, tx} body ONLY when ARC_BV_DIRECT_SUBSCRIBE=1 (dev mode),
 * otherwise it answers 402. All subscribe calls additionally require the
 * admin+ wallet signature (owner/delegate pays for their own venue).
 */
import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { requireVenueAccess } from "../middleware/venue-auth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { getVenue, type VenueRecord } from "../lib/venue/venues";
import {
  effectiveTakeRateBps,
  venueEconomics,
} from "../lib/venue/economics";
import {
  extendVenueSubscription,
  listVenuePayments,
  subscriptionStatus,
  venueMonthlyPriceAtomic,
} from "../lib/venue/billing";

export interface SubscriptionSettled {
  payer: `0x${string}`;
  amountAtomic: string;
  tx?: string;
}

export interface VenueBillingDeps {
  /** x402 settle seam — returns the settled payment or null to 402. */
  subscriptionSettle?: (
    c: Context,
    venue: VenueRecord,
  ) => Promise<SubscriptionSettled | null>;
  /** Optional ARC_BV_MINT_PASS hook — mint/extend pass after subscribe. */
  mintVenuePass?: (
    payer: `0x${string}`,
    durationSec: number,
  ) => Promise<string | null>;
}

function economicsPayload(venue: VenueRecord) {
  const rate = effectiveTakeRateBps(venue);
  const econ = venueEconomics(venue);
  return {
    venueId: venue.id,
    takeRateBps: rate.bps,
    takeRateSource: rate.source,
    evalFeeAtomic: econ.evalFeeAtomic.toString(),
    treasury: econ.treasury,
    feeHook: econ.feeHook,
    subscriptionStatus: subscriptionStatus(venue),
    subscription: venue.subscription ?? null,
    monthlyPriceAtomic: venueMonthlyPriceAtomic().toString(),
  };
}

export function registerVenueBillingRoutes(
  app: Hono,
  deps: VenueBillingDeps = {},
): void {
  // POST /api/venue/instances/:id/subscribe — admin+ wallet-sig + payment.
  app.post("/api/venue/instances/:id/subscribe", describeRoute({
    tags: ["Venue"],
    summary:
      "Extend venue subscription — x402 USDC payment, additive expiry",
    responses: {
      200: { description: "Subscription extended" },
      400: { description: "Invalid amount" },
      401: { description: "Signature check failed" },
      402: { description: "Payment required / not settled" },
      403: { description: "Requires admin+ role" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    const body = (await c.req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    let settled: SubscriptionSettled | null = null;
    if (deps.subscriptionSettle) {
      settled = await deps.subscriptionSettle(c, access.venue);
      if (!settled) {
        return errorResponse(c, 402, ErrorCodes.PAYMENT_REQUIRED,
          `subscription payment required — ${venueMonthlyPriceAtomic()} USDC atomic / month`);
      }
    } else if (process.env.ARC_BV_DIRECT_SUBSCRIBE === "1") {
      const amountAtomic = String(body?.amountAtomic ?? "");
      if (!/^[0-9]+$/.test(amountAtomic) || BigInt(amountAtomic) <= 0n) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          "amountAtomic (USDC base units) required");
      }
      settled = {
        payer: access.wallet,
        amountAtomic,
        tx: typeof body?.tx === "string" ? body.tx : undefined,
      };
    } else {
      return errorResponse(c, 402, ErrorCodes.PAYMENT_REQUIRED,
        "x402 subscription payment required — no settle backend wired");
    }

    const res = extendVenueSubscription({
      venueId: access.venue.id,
      payer: settled.payer,
      amountAtomic: settled.amountAtomic,
      tx: settled.tx,
      venue: access.venue,
    });
    if (!res) {
      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR,
        "failed to persist subscription");
    }

    // Optional public proof-of-subscription pass (ARC_BV_MINT_PASS=1).
    let passTx: string | null = null;
    if (process.env.ARC_BV_MINT_PASS === "1" && deps.mintVenuePass) {
      try {
        passTx = await deps.mintVenuePass(settled.payer, res.durationSec);
      } catch {
        passTx = null; // mint failure never blocks the settled subscription
      }
    }

    return c.json({
      venue: res.venue,
      subscription: res.venue.subscription,
      durationSec: res.durationSec,
      expiresAt: res.expiresAt,
      passTx,
    });
  });

  // GET /api/venue/instances/:id/economics — per-venue take-rate resolution.
  app.get("/api/venue/instances/:id/economics", describeRoute({
    tags: ["Venue"],
    summary: "Venue-specific economics: effective take-rate + source",
    responses: {
      200: { description: "Economics payload" },
      404: { description: "Unknown venue" }
    },
  }), (c) => {
    const venue = getVenue(c.req.param("id"));
    if (!venue || venue.kind !== "business") {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
        "venue not found");
    }
    return c.json(economicsPayload(venue));
  });

  // GET /api/venue/instances/:id/billing — admin+ subscription + ledger.
  app.get("/api/venue/instances/:id/billing", describeRoute({
    tags: ["Venue"],
    summary: "Billing payload: subscription status + payment history",
    responses: {
      200: { description: "Billing payload" },
      401: { description: "Signature check failed" },
      403: { description: "Requires admin+ role" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    return c.json({
      ...economicsPayload(access.venue),
      payments: listVenuePayments(access.venue.id),
    });
  });
}
