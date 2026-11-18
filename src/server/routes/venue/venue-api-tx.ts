/**
 * SLICE-234-19 extraction: POST /api/venue/jobs/:id/tx — attach broadcast
 * tx hash for a phase. Moved from venue-api-lifecycle.ts (max-lines).
 * evalFee phase is 152-4: client's upfront USDC transfer to treasury
 * gating evaluate — sig+client guard added in 234-19.
 */
import type { Hono } from "hono";
import { getJob, upsertJob, type VenueJob } from "../../lib/venue/store";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { dr, str, TX_PHASES } from "./venue-api-helpers";
import { recordVenueEvent } from "../../services/venue-events";
import { verifySignedRequest } from "../../middleware/agent-auth";
import type { LifecycleDeps } from "./venue-api-lifecycle-core";

export function registerTxAttachRoutes(app: Hono, deps: LifecycleDeps): void {
  const net = deps.network;

  // POST /api/venue/jobs/:id/tx — attach broadcast tx hash for a phase.
  // Moved here from venue-api.ts (max-lines split); evalFee phase is
  // 152-4: client's upfront USDC transfer to treasury gating evaluate.
  app.post("/api/venue/jobs/:id/tx", dr("Attach tx hash to job phase"), async (c) => {
    const job = getJob(c.req.param("id") ?? "");
    if (!job) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown jobId");
    }
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const hash = str(body?.hash, 66);
    const phase = str(body?.phase, 20);
    if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "hash must be 0x<64hex>");
    }
    if (phase === "evalFee") {
      // 234-19: evalFee attach sets paid=true — require the job client's
      // wallet signature, otherwise anyone could mark the fee paid with
      // an arbitrary 0x-hash and skip the evaluator-fee gate (S-audit).
      const sig = await verifySignedRequest(c);
      if (sig === "replay") {
        return errorResponse(c, 409, ErrorCodes.CONFLICT, "replayed signed request");
      }
      if (sig !== "valid") {
        return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
          "evalFee attach requires a valid X-Wallet/X-Sig/X-Timestamp/X-Nonce");
      }
      const wallet = c.req.header("x-wallet")!.toLowerCase();
      if (wallet !== job.client.toLowerCase()) {
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
          "evalFee may only be attached by the job client");
      }
      job.evalFee = {
        required: true,
        paid: true,
        amountAtomic: job.evalFee?.amountAtomic,
        tx: hash,
        payer: wallet,
      };
      upsertJob(job);
      recordVenueEvent({
        action: "job.evalfee",
        text: `job ${job.jobId} — evaluator fee paid`,
        jobId: job.jobId,
        tx: hash,
        dedupeKey: `job.evalfee:${job.jobId}`,
      });
      return c.json({ job });
    }
    if (!phase || !(TX_PHASES as readonly string[]).includes(phase)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
        "phase ∈ {created,funded,submitted,completed,evalFee}");
    }
    job.chainTxs[phase as keyof VenueJob["chainTxs"]] = hash;
    if (phase === "rated" && job.rating) job.rating.txHash = hash; // 153-6
    if (phase === "created" && job.status === "pending") job.status = "open";
    if (phase === "created" && job.onchainJobId == null && deps.txJobId) {
      const id = await deps.txJobId(hash as `0x${string}`, net());
      if (id != null) job.onchainJobId = id;
    }
    upsertJob(job);
    recordVenueEvent({
      action: "job.tx",
      text: `job ${job.jobId} — ${phase} tx confirmed`,
      jobId: job.jobId,
      tx: hash,
      dedupeKey: `job.tx:${job.jobId}:${phase}`,
    });
    return c.json({ job });
  });
}
