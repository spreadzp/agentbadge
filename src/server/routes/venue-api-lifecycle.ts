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
import { dr, str, ERC8183_STATUS } from "./venue-api-helpers";
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
  handleAction,
  maybeFeedback,
  type ActionCtx,
  type LifecycleDeps,
} from "./venue-api-lifecycle-core";

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
          // 152-3: claimer may attach its ERC-8004 agentId for feedback.
          const agentId = Number(body.agentId);
          if (Number.isInteger(agentId) && agentId > 0) {
            job.providerAgentId = agentId;
          }
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
      if (!deliverable) {
        return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
          "deliverable required — bytes32 hex or URI/text to hash");
      }
      const hash = deliverableHash(deliverable);
      return {
        txs: buildActionTxs(net(), "submit", {
          onchainJobId: g.onchainId,
          deliverable: hash,
        }),
        extra: { deliverableHash: hash },
        mutate: (job) => {
          job.deliverableHash = hash;
        },
      };
    }),
  );

  // POST /api/venue/jobs/:id/evaluate — evaluator verdict → complete|reject.
  app.post("/api/venue/jobs/:id/evaluate", dr("Evaluator verdict → complete|reject"), (c) =>
    handleAction(c, ctx, "complete", (body, g) => {
      const verdict = str(body.verdict, 10);
      const reason = str(body.reason, 500);
      const reasonHex = reason ? keccak256(toBytes(reason)) : undefined;
      if (verdict === "reject") {
        return {
          txs: buildActionTxs(net(), "reject", {
            onchainJobId: g.onchainId,
            reason: reasonHex,
          }),
          status: "rejected",
          phase: "rejected",
          mutate: (j) => {
            j.verdict = `rejected${reason ? `: ${reason}` : ""}`;
          },
        };
      }
      return {
        txs: buildActionTxs(net(), "complete", {
          onchainJobId: g.onchainId,
          reason: reasonHex,
        }),
        mutate: (j) => {
          j.verdict = `approved${reason ? `: ${reason}` : ""}`;
        },
      };
    }),
  );

  // POST /api/venue/jobs/:id/reject — evaluator (funded/submitted) or client (open).
  app.post("/api/venue/jobs/:id/reject", dr("Reject job → escrow refund"), (c) =>
    handleAction(c, ctx, "reject", (body, g) => {
      const reason = str(body.reason, 500);
      return {
        txs: buildActionTxs(net(), "reject", {
          onchainJobId: g.onchainId,
          reason: reason ? keccak256(toBytes(reason)) : undefined,
        }),
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

  // GET /api/venue/jobs/:id — merged store + onchain tuple + verdict.
  app.get("/api/venue/jobs/:id", dr("Job detail (store + onchain merge)"), async (c) => {
    const job = getJob(c.req.param("id") ?? "");
    if (!job) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown jobId");
    }
    if (job.onchainJobId == null) return c.json({ job, onchain: null });
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
      // 152-3: calldata-mode evaluations land here — fire feedback on
      // first terminal-status observation (idempotent via store gate).
      await maybeFeedback(job, ctx);
    }
    return c.json({ job, onchain: raw });
  });
}
