/**
 * SLICE-153-6: client rating — subjective ERC-8004 channel (D7).
 *
 *   POST /api/venue/jobs/:id/rate                    — client signs calldata
 *   POST /api/venue/instances/:id/jobs/:jobId/rate   — venue-scoped variant
 *
 * Guards (all before calldata is built):
 *   - caller (wallet sig) must equal job.client — anti-farming: only the
 *     paying client can rate; ERC-8004 owner-self-call ban can't trigger
 *     because client ≠ agent owner;
 *   - onchain job status must be Completed (getJob pull);
 *   - one rating per job — job.rating already set → 409.
 *
 * Response: {tx: {to, data}} giveFeedback calldata — NO sign:"server"
 * mode: the rating must land from the client wallet or the anti-fraud
 * property breaks. Client broadcasts, then attaches the hash via
 * POST /jobs/:id/tx {hash, phase:"rated"} → rating.txHash.
 */
import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { getJob, upsertJob } from "../lib/venue/store";
import { getVenue, venueIdOf } from "../lib/venue/venues";
import type { VenueNetwork } from "../lib/venue/chain";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  dr,
  ERC8183_STATUS,
  signedJson,
  str,
} from "./venue-api-helpers";
import type { OnchainJobRaw } from "../lib/venue/lifecycle";
import {
  buildClientRatingTx,
  composeClientRating,
} from "../lib/venue/reputation";
import { recordVenueEvent } from "../services/venue-events";

export interface RatingDeps {
  network: () => VenueNetwork;
  onchainJob: (id: number, net: VenueNetwork) => Promise<unknown>;
}

async function handleRate(
  c: Context,
  deps: RatingDeps,
  forcedVenue?: string,
): Promise<Response> {
  const s = await signedJson(c);
  if (s instanceof Response) return s;
  const { body } = s;
  const jobId = c.req.param(forcedVenue ? "jobId" : "id") ?? "";
  const job = getJob(jobId);
  if (!job) {
    return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
      "unknown jobId");
  }
  if (forcedVenue) {
    const venue = getVenue(forcedVenue);
    if (!venue || venueIdOf(job) !== venue.id) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
        "unknown venue/job pair");
    }
  }

  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
      "score must be an integer 1..5");
  }
  const comment = str(body.comment, 500) ?? undefined;

  // Caller must be the paying client (stored + onchain both checked).
  const onchainId = job.onchainJobId;
  if (onchainId == null) {
    return errorResponse(c, 409, ErrorCodes.INVALID_STATE,
      "job has no onchainJobId — rating requires a completed onchain job");
  }
  const raw = (await deps.onchainJob(onchainId, deps.network())) as
    OnchainJobRaw | null;
  if (!raw) {
    return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR,
      "onchain getJob read failed — retry");
  }
  if (raw.client.toLowerCase() !== s.wallet.toLowerCase()) {
    return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
      "only the job client can rate");
  }
  if (ERC8183_STATUS[raw.status] !== "completed") {
    return errorResponse(c, 409, ErrorCodes.INVALID_STATE,
      `job must be Completed onchain to rate — current: ${ERC8183_STATUS[raw.status]}`);
  }
  if (job.rating) {
    return errorResponse(c, 409, ErrorCodes.INVALID_STATE,
      "job already rated");
  }

  const agentId = job.providerAgentId;
  if (agentId == null) {
    return errorResponse(c, 409, ErrorCodes.INVALID_STATE,
      "provider has no ERC-8004 agentId — nothing to rate against");
  }

  // Store rating first — calldata hand-off is idempotent via job.rating.
  job.rating = { score, comment, at: new Date().toISOString() };
  upsertJob(job);
  recordVenueEvent({
    action: "job.rated",
    text: `job ${job.jobId} — client rated ${score}/5`,
    jobId: job.jobId,
    dedupeKey: `job.rated:${job.jobId}`,
  });

  const n = deps.network();
  const fb = composeClientRating({
    job, agentId: BigInt(agentId), score, comment,
  });
  const tx = buildClientRatingTx(n, fb);
  return c.json({
    job,
    tx,
    note:
      "Broadcast giveFeedback from your client wallet, then POST " +
      `/api/venue/jobs/${job.jobId}/tx {hash, phase:"rated"} to attach it.`,
  });
}

export function registerVenueRatingRoutes(
  app: Hono,
  deps: RatingDeps,
): void {
  app.post("/api/venue/jobs/:id/rate", dr("Client rating → giveFeedback calldata"), (c) =>
    handleRate(c, deps));

  app.post("/api/venue/instances/:id/jobs/:jobId/rate", describeRoute({
    tags: ["Venue"],
    summary: "Client rating scoped to a venue instance",
    responses: {
      200: { description: "giveFeedback calldata + updated job" },
      400: { description: "Invalid score" },
      403: { description: "Only the job client can rate" },
      404: { description: "Unknown venue/job pair" },
      409: { description: "Not completed onchain / already rated / no agentId" },
    },
  }), (c) => handleRate(c, deps, c.req.param("id")));
}
