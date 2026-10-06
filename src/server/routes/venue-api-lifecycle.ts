/**
 * SLICE-152-2/3: job lifecycle routes — claim/fund/submit/evaluate/reject/
 * refund + merged GET /jobs/:id. Shared signed→onchain-gate→sign-mode
 * pipeline lives in venue-api-lifecycle-core.ts (max-lines split).
 */
import type { Hono } from "hono";
import { keccak256, toBytes } from "viem";
import { getJob, upsertJob, type VenueJob } from "../lib/venue/store";
import type { VenueNetwork } from "../lib/venue/chain";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { disclosureExtra } from "../lib/disclosure";
import { dr, str, ERC8183_STATUS, TX_PHASES } from "./venue-api-helpers";
import {
  buildActionTxs,
  deliverableHash,
  sendAsRole,
  type OnchainJobRaw,
  type PreparedTx,
  type VenueRole,
} from "../lib/venue/lifecycle";
import { recordVenueEvent } from "../services/venue-events";
import {
  resolveFeeMode,
  venueEconomics,
} from "../lib/venue/economics";
import {
  handleAction,
  maybeFeedback,
  maybeFeeSweep,
  type ActionCtx,
  type LifecycleDeps,
} from "./venue-api-lifecycle-core";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { getVenue, venueIdOf } from "../lib/venue/venues";
import { venueHasRole } from "../lib/venue/members";
import {
  getPrivateJob,
  updatePrivateJob,
  privateLimit,
  type PrivateJobPayload,
} from "../lib/venue/private-jobs";

export type { LifecycleDeps } from "./venue-api-lifecycle-core";

export function registerLifecycleRoutes(app: Hono, deps: LifecycleDeps): void {
  const net = deps.network;
  const ctx: ActionCtx = {
    deps,
    net,
    sendTx: deps.sendTx ?? ((role: VenueRole, txs: PreparedTx[], n: VenueNetwork) =>
      sendAsRole(role, txs, n.chain.rpcUrl)),
  };

  // POST /api/venue/jobs/:id/claim — provider self-assigns + optional setBudget.
  app.post("/api/venue/jobs/:id/claim", dr("Provider claims job (setBudget)"), (c) =>
    handleAction(c, ctx, "claim", (body, g) => {
      const amountUsdc =
        body.budgetUsdc === undefined || body.budgetUsdc === null
          ? g.job.budgetUsdc
          : Number(body.budgetUsdc);
      if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          "budgetUsdc must be a positive number");
      }
      return {
        txs: buildActionTxs(net(), "claim", {
          onchainJobId: g.onchainId,
          amountUsdc,
        }),
        mutate: (job, wallet) => {
          job.provider = wallet;
          // 152-4/153-5: per-venue take-rate re-resolve once provider known
          // (server EOA provider → "sweep", else "none"/"hook").
          job.feeMode = resolveFeeMode(
            job, venueEconomics(getVenue(venueIdOf(job))), net());
          const agentId = Number(body.agentId); // 152-3 ERC-8004 claimer
          if (Number.isInteger(agentId) && agentId > 0) job.providerAgentId = agentId;
        },
      };
    }),
  );

  // POST /api/venue/jobs/:id/fund — client: approve + fund calldata.
  app.post("/api/venue/jobs/:id/fund", dr("Client funds escrow (approve+fund)"), (c) =>
    handleAction(c, ctx, "fund", (body, g) => ({
      txs: buildActionTxs(net(), "fund", {
        onchainJobId: g.onchainId,
        amountUsdc:
          body.budgetUsdc === undefined || body.budgetUsdc === null
            ? g.job.budgetUsdc
            : Number(body.budgetUsdc),
      }),
    })),
  );

  // POST /api/venue/jobs/:id/submit — provider: deliverable hash (bytes32 or text).
  app.post("/api/venue/jobs/:id/submit", dr("Provider submits deliverable"), (c) =>
    handleAction(c, ctx, "submit", (body, g) => {
      const deliverable = str(body.deliverable, 2048);
      // 153-3: deliverableData stays off-chain (venue private record);
      // only keccak256(data) goes onchain via submit.
      let deliverableData: string | undefined;
      if (body.deliverableData != null) {
        if (typeof body.deliverableData !== "string" ||
          Buffer.byteLength(body.deliverableData) > privateLimit()) {
          return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
            `deliverableData exceeds ${privateLimit()}B — use deliverableUri`);
        }
        deliverableData = body.deliverableData;
      }
      const deliverableUri = str(body.deliverableUri, 512);
      const raw = deliverableData ?? deliverable;
      if (!raw) {
        return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
          "deliverable or deliverableData required — bytes32 hex, URI/text, or off-chain payload to hash");
      }
      const hash = deliverableHash(raw);
      return {
        txs: buildActionTxs(net(), "submit", {
          onchainJobId: g.onchainId,
          deliverable: hash,
        }),
        extra: { deliverableHash: hash },
        mutate: (job) => {
          job.deliverableHash = hash;
          // Private record exists for business-venue jobs — store payload.
          if (deliverableData != null || deliverableUri != null) {
            updatePrivateJob(job.jobId, {
              deliverableData,
              deliverableUri: deliverableUri ?? undefined,
            });
          }
        },
      };
    }),
  );

  // POST /api/venue/jobs/:id/evaluate — evaluator verdict → complete|reject.
  app.post("/api/venue/jobs/:id/evaluate", dr("Evaluator verdict → complete|reject (reject carries disclosure{decided_by,appeal,basis})"), (c) =>
    handleAction(c, ctx, "complete", (body, g) => {
      // 152-4: eval fee must be paid upfront — client attaches the USDC
      // transfer tx via POST /jobs/:id/tx {phase:"evalFee"} first.
      if (g.job.evalFee?.required && !g.job.evalFee.paid) {
        return errorResponse(c, 402, ErrorCodes.PAYMENT_REQUIRED,
          `evaluator fee unpaid — transfer ${g.job.evalFee.amountAtomic} USDC atomic to treasury, ` +
          `then POST /api/venue/jobs/${g.job.jobId}/tx {hash, phase:"evalFee"}`);
      }
      const verdict = str(body.verdict, 10);
      const reason = str(body.reason, 500);
      const reasonHex = reason ? keccak256(toBytes(reason)) : undefined;
      if (verdict === "reject") {
        return {
          txs: buildActionTxs(net(), "reject", { onchainJobId: g.onchainId, reason: reasonHex }),
          status: "rejected",
          phase: "rejected",
          mutate: (j) => { j.verdict = `rejected${reason ? `: ${reason}` : ""}`; },
          // 181-4: evaluator reject — unilateral decision disclosure.
          extra: disclosureExtra("evaluator", `evaluator verdict: reject${reason ? ` — ${reason}` : ""}`),
        };
      }
      return {
        txs: buildActionTxs(net(), "complete", { onchainJobId: g.onchainId, reason: reasonHex }),
        mutate: (j) => { j.verdict = `approved${reason ? `: ${reason}` : ""}`; },
      };
    }),
  );

  // POST /api/venue/jobs/:id/reject — evaluator (funded/submitted) or client (open).
  app.post("/api/venue/jobs/:id/reject", dr("Reject job → escrow refund (response carries disclosure{decided_by,appeal,basis})"), (c) =>
    handleAction(c, ctx, "reject", (body, g) => {
      const reason = str(body.reason, 500);
      return {
        txs: buildActionTxs(net(), "reject", {
          onchainJobId: g.onchainId,
          reason: reason ? keccak256(toBytes(reason)) : undefined,
        }),
        // 181-4: reject is unilateral — disclose decided_by + appeal.
        extra: disclosureExtra(g.status === "open" ? "client" : "evaluator", `job reject${reason ? ` — ${reason}` : ""}`),
      };
    }),
  );

  // POST /api/venue/jobs/:id/refund — client claims refund on expired job.
  app.post("/api/venue/jobs/:id/refund", dr("Claim refund (expired)"), (c) =>
    handleAction(c, ctx, "refund", (_body, g) => ({
      txs: buildActionTxs(net(), "refund", {
        onchainJobId: g.onchainId,
      }),
    })),
  );

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
      job.evalFee = {
        required: true,
        paid: true,
        amountAtomic: job.evalFee?.amountAtomic,
        tx: hash,
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

  // GET /api/venue/jobs/:id — merged store + onchain tuple + verdict.
  app.get("/api/venue/jobs/:id", dr("Job detail (store + onchain merge)"), async (c) => {
    const job = getJob(c.req.param("id") ?? "");
    if (!job) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown jobId");
    }
    // 153-3: privateDetails for members only (absent otherwise); "members" venues 403 strangers.
    const venue = job.venueId ? getVenue(job.venueId) : undefined;
    let privateDetails: PrivateJobPayload | undefined;
    if (venue?.kind === "business") {
      const sig = await verifyWalletSigRequest({
        wallet: c.req.header("x-wallet"),
        signature: c.req.header("x-sig"),
        timestamp: c.req.header("x-timestamp"),
        method: "GET",
        path: c.req.path,
      });
      const wallet = sig === "valid" ? c.req.header("x-wallet") : undefined;
      const member = !!wallet && venueHasRole(venue, wallet, "viewer");
      if (!member && venue.clientPolicy !== "open") {
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
          "venue members only — join the venue to view this job");
      }
      if (member) privateDetails = getPrivateJob(job.jobId);
    }
    const jobOut = privateDetails ? { ...job, privateDetails } : job;
    if (job.onchainJobId == null) return c.json({ job: jobOut, onchain: null });
    const raw = (await deps.onchainJob(job.onchainJobId, net())) as OnchainJobRaw | null;
    if (raw) {
      const mapped = ERC8183_STATUS[raw.status];
      if (mapped && mapped !== job.status) {
        recordVenueEvent({
          action: "job.status",
          text: `job ${job.jobId} — ${job.status} → ${mapped}`,
          jobId: job.jobId,
          dedupeKey: `job.status:${job.jobId}:${mapped}`,
        });
        job.status = mapped as VenueJob["status"];
        upsertJob(job);
      }
      // 152-4: take-rate sweep on completed (idempotent store gate).
      await maybeFeeSweep(job, ctx);
      // 152-3: calldata-mode evaluations land here — fire feedback on
      // first terminal-status observation (idempotent via store gate).
      await maybeFeedback(job, ctx);
    }
    return c.json({ job: jobOut, onchain: raw });
  });
}
