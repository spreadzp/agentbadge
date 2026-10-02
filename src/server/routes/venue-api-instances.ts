/**
 * SLICE-153-1: Venue instances API — tenancy registry CRUD + scoped listings.
 *
 *   POST /api/venue/instances            — create business venue (wallet-sig)
 *   GET  /api/venue/instances            — public registry listing
 *   GET  /api/venue/instances/:id        — venue meta (id or slug)
 *   GET  /api/venue/instances/:id/jobs   — scoped job listing
 *   GET  /api/venue/instances/:id/offers — scoped offer listing
 *
 * Existing /api/venue/jobs|offers stay the public-venue shorthand
 * (?venue= query narrows to a specific venue). Access control (membership,
 * whitelist) lands in 153-2 — this slice ships namespace + registry only.
 */
import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isAddress } from "viem";

import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  createVenue,
  getVenue,
  listVenues,
  PUBLIC_VENUE_ID,
  type VenueCreateInput,
} from "../lib/venue/venues";
import { listJobs, listOffers } from "../lib/venue/store";

/**
 * 153-1 tenancy scope: id-or-slug → venue.id.
 * Unknown slugs pass through raw so scoped lists resolve empty (not 500).
 */
export function venueScope(idOrSlug: string | undefined): string | undefined {
  return idOrSlug ? (getVenue(idOrSlug)?.id ?? idOrSlug) : undefined;
}

/** Write-path variant: unknown venue → 404 Response (caller must return it). */
export function venueScopeOr404(
  c: Context,
  idOrSlug: string | null | undefined,
): string | Response | undefined {
  if (!idOrSlug) return undefined;
  const v = getVenue(idOrSlug);
  return v
    ? v.id
    : errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
      `unknown venue "${idOrSlug}"`);
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t && t.length <= max ? t : undefined;
}

export function registerVenueInstanceRoutes(app: Hono): void {
  // POST /api/venue/instances — wallet-sig auth, owner = signer.
  app.post("/api/venue/instances", describeRoute({
    tags: ["Venue"],
    summary: "Create business venue (wallet-sig; owner = signer)",
    responses: {
      200: { description: "Created venue record" },
      401: { description: "Signature check failed" },
      409: { description: "Slug taken or limit reached" }
    },
  }), async (c) => {
    const check = await verifyWalletSigRequest({
      wallet: c.req.header("x-wallet"),
      signature: c.req.header("x-sig"),
      timestamp: c.req.header("x-timestamp"),
      method: "POST",
      path: "/api/venue/instances",
    });
    if (check !== "valid") {
      return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
        "wallet signature required (x-wallet/x-sig/x-timestamp)");
    }
    const body = (await c.req.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "json body required");
    }
    const name = str(body.name, 120);
    const slug = str(body.slug, 64);
    if (!name || !slug) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
        "name (≤120) + slug (≤64) required");
    }
    const delegates = Array.isArray(body.delegates)
      ? body.delegates.filter(
        (d): d is `0x${string}` =>
          typeof d === "string" && isAddress(d),
      )
      : undefined;
    const input: VenueCreateInput = {
      name,
      slug,
      kind: "business",
      ownerWallet: c.req.header("x-wallet") as `0x${string}`,
      description: str(body.description, 500),
      delegates,
    };
    try {
      const venue = createVenue(input);
      return c.json({ venue }, 201);
    } catch (err) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, String(err));
    }
  });

  // GET /api/venue/instances — public registry listing (cards only).
  app.get("/api/venue/instances", describeRoute({
    tags: ["Venue"],
    summary: "List venue registry (?kind=business)",
    responses: { 200: { description: "Venue list" } },
  }), (c) => {
    const kind = c.req.query("kind");
    const venues = listVenues(kind ? { kind } : undefined);
    return c.json({ venues });
  });

  // GET /api/venue/instances/:id — meta by id or slug.
  app.get("/api/venue/instances/:id", describeRoute({
    tags: ["Venue"],
    summary: "Venue meta by id or slug",
    responses: {
      200: { description: "Venue record" },
      404: { description: "Unknown venue" }
    },
  }), (c) => {
    const venue = getVenue(c.req.param("id"));
    if (!venue) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "venue not found");
    }
    return c.json({ venue });
  });

  // GET /api/venue/instances/:id/jobs — scoped listing.
  app.get("/api/venue/instances/:id/jobs", describeRoute({
    tags: ["Venue"],
    summary: "Jobs scoped to a venue (id or slug)",
    responses: {
      200: { description: "Job list" },
      404: { description: "Unknown venue" }
    },
  }), (c) => {
    const venue = getVenue(c.req.param("id"));
    if (!venue) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "venue not found");
    }
    const jobs = listJobs({ venueId: venue.id });
    return c.json({ jobs });
  });

  // GET /api/venue/instances/:id/offers — scoped listing.
  app.get("/api/venue/instances/:id/offers", describeRoute({
    tags: ["Venue"],
    summary: "Offers scoped to a venue (id or slug)",
    responses: {
      200: { description: "Offer list" },
      404: { description: "Unknown venue" }
    },
  }), (c) => {
    const venue = getVenue(c.req.param("id"));
    if (!venue) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "venue not found");
    }
    const offers = listOffers({ venueId: venue.id });
    return c.json({ offers });
  });
}

export { PUBLIC_VENUE_ID };
