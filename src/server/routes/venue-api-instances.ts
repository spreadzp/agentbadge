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
import { requireVenueAccess } from "../middleware/venue-auth";
import {
  addVenueMember,
  listVenueMembers,
  revokeVenueMember,
  venueRole,
} from "../lib/venue/members";
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

/** Write-path variant: unknown venue → 404 Response (caller must return it).
 * With `clientWallet`, a business venue under clientPolicy "members" (the
 * default) 403s non-members — strangers may only post to "open" venues. */
export function venueScopeOr404(
  c: Context,
  idOrSlug: string | null | undefined,
  clientWallet?: string,
): string | Response | undefined {
  if (!idOrSlug) return undefined;
  const v = getVenue(idOrSlug);
  if (!v) {
    return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
      `unknown venue "${idOrSlug}"`);
  }
  if (
    clientWallet &&
    v.kind === "business" &&
    (v.clientPolicy ?? "members") === "members" &&
    !venueRole(v, clientWallet)
  ) {
    return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
      "venue accepts jobs from members only");
  }
  return v.id;
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
      401: { description: "Signature required" },
      403: { description: "Not a venue member" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "viewer");
    if (access instanceof Response) return access;
    return c.json({ jobs: listJobs({ venueId: access.venue.id }) });
  });

  // GET /api/venue/instances/:id/offers — scoped listing.
  app.get("/api/venue/instances/:id/offers", describeRoute({
    tags: ["Venue"],
    summary: "Offers scoped to a venue (id or slug)",
    responses: {
      200: { description: "Offer list" },
      401: { description: "Signature required" },
      403: { description: "Not a venue member" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "viewer");
    if (access instanceof Response) return access;
    return c.json({ offers: listOffers({ venueId: access.venue.id }) });
  });

  // ─── Member management (153-2) ────────────────────────────────

  // GET /api/venue/instances/:id/members — members only (viewer+).
  app.get("/api/venue/instances/:id/members", describeRoute({
    tags: ["Venue"],
    summary: "Venue member roster (members only)",
    responses: {
      200: { description: "Member list" },
      403: { description: "Not a venue member" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "viewer");
    if (access instanceof Response) return access;
    const members = listVenueMembers(access.venue.id, {
      includeRevoked: access.role === "owner" || access.role === "admin",
    });
    return c.json({ members });
  });

  // POST /api/venue/instances/:id/members {wallet, role} — admin+.
  app.post("/api/venue/instances/:id/members", describeRoute({
    tags: ["Venue"],
    summary: "Add venue member {wallet, role} (admin+)",
    responses: {
      201: { description: "Member added" },
      403: { description: "Requires admin+" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    const body = (await c.req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "JSON body required");
    }
    try {
      const member = addVenueMember(access.venue.id, {
        wallet: String(body.wallet ?? ""),
        role: body.role as "admin" | "provider" | "viewer",
        addedBy: access.wallet,
      });
      return c.json({ member }, 201);
    } catch (err) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, String(err));
    }
  });

  // DELETE /api/venue/instances/:id/members/:wallet — admin+, sticky revoke.
  app.delete("/api/venue/instances/:id/members/:wallet", describeRoute({
    tags: ["Venue"],
    summary: "Revoke venue member (admin+)",
    responses: {
      200: { description: "Member revoked" },
      403: { description: "Requires admin+" },
      404: { description: "Unknown venue or member" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    const ok = revokeVenueMember(access.venue.id, c.req.param("wallet"));
    if (!ok) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
        "member not found");
    }
    return c.json({ revoked: true });
  });
}

export { PUBLIC_VENUE_ID };
