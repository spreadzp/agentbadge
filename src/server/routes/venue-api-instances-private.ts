/**
 * SLICE-153-3: Private-job routes scoped to a venue instance.
 *
 *   POST /api/venue/instances/:id/jobs                     — create in forced
 *     venue scope (member gate per clientPolicy; privateDetails off-chain
 *     for business venues)
 *   POST /api/venue/instances/:id/jobs/:jobId/verify-commitment — PUBLIC
 *     hash-compare only; third party proves "this is what was ordered"
 *     without venue access (rate-limited 20/min per venue+ip)
 *
 * Kept separate from venue-api-instances.ts (300-line file cap).
 */
import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { getVenue } from "../lib/venue/venues";
import { getJob } from "../lib/venue/store";
import type { VenueNetwork } from "../lib/venue/chain";
import {
  computeCommitment,
  getPrivateJob,
} from "../lib/venue/private-jobs";
import { createVenueJob } from "./venue-job-create";

/** Fixed-window rate buckets for verify-commitment (per venue+ip, 20/min). */
const verifyBuckets = new Map<string, { count: number; resetAt: number }>();

export function registerVenueInstancePrivateRoutes(
  app: Hono,
  net: () => VenueNetwork,
): void {
  // POST /api/venue/instances/:id/jobs — create in forced venue scope.
  // clientPolicy members|open enforced inside createVenueJob (venueScopeOr404).
  app.post("/api/venue/instances/:id/jobs", describeRoute({
    tags: ["Venue"],
    summary: "Post job into a venue (member gate per clientPolicy; privateDetails off-chain for business venues)",
    responses: {
      200: { description: "Job + prepared createJob tx" },
      401: { description: "Signature check failed" },
      403: { description: "clientPolicy=members and wallet is not a member" },
      404: { description: "Unknown venue" }
    },
  }), (c) => createVenueJob(c, net, c.req.param("id")));

  // POST …/jobs/:jobId/verify-commitment — PUBLIC, hash-compare only.
  app.post("/api/venue/instances/:id/jobs/:jobId/verify-commitment", describeRoute({
    tags: ["Venue"],
    summary: "Verify a claimed private payload against the stored commitment (public)",
    responses: {
      200: { description: "{match: boolean}" },
      404: { description: "Unknown venue/job or no private record" },
      429: { description: "Rate limited" }
    },
  }), async (c) => {
    const key = `${c.req.param("id")}:${c.req.header("x-forwarded-for") ?? "anon"}`;
    const now = Date.now();
    const bucket = verifyBuckets.get(key);
    if (bucket && now < bucket.resetAt && bucket.count >= 20) {
      return errorResponse(c, 429, ErrorCodes.RATE_LIMITED,
        "verify-commitment: 20 req/min per venue");
    }
    verifyBuckets.set(key, {
      count: (bucket && now < bucket.resetAt ? bucket.count : 0) + 1,
      resetAt: (bucket && now < bucket.resetAt ? bucket.resetAt : now + 60_000),
    });
    const venue = getVenue(c.req.param("id"));
    const job = getJob(c.req.param("jobId") ?? "");
    if (!venue || !job || job.venueId !== venue.id) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
        "unknown venue/job pair");
    }
    const priv = getPrivateJob(job.jobId);
    if (!priv) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
        "job has no private record");
    }
    const body = (await c.req.json().catch(() => null)) as
      | { descriptionFull?: unknown; terms?: unknown }
      | null;
    if (!body || body.descriptionFull == null) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
        "descriptionFull required");
    }
    const match = computeCommitment({
      jobId: job.jobId,
      venueId: venue.id,
      descriptionFull: String(body.descriptionFull),
      terms: body.terms != null ? String(body.terms) : undefined,
    }) === priv.commitment;
    return c.json({ match });
  });
}
