/**
 * SLICE-152-2: job lifecycle routes — claim/fund/submit/evaluate/reject/refund.
 * Extracted from venue-api.ts (max-lines). Every mutation validates the
 * ONCHAIN status via deps.onchainJob before recording (409 on mismatch).
 *
 * Sign modes (body.sign): "calldata" (default) → {txs:[{to,data}]} for the
 * caller's wallet; "server" → txs sent from role EOA via deps.sendTx
 * (default: lifecycle.sendAsRole gated by ARC_VENUE_SERVER_WALLETS).
 */
import type { Context, Hono } from "hono";
import { keccak256, toBytes, type Hex } from "viem";
import { logger } from "@agentbadge/passport";
import { getJob, upsertJob, type VenueJob } from "../lib/venue/store";
import type { VenueNetwork } from "../lib/venue/chain";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { dr, signedJson, str, ERC8183_STATUS } from "./venue-api-helpers";
import {
  ACTION_ROLE,
  RESULT_STATUS,
  actorAllowed,
  assertTransition,
  buildActionTxs,
  deliverableHash,
  sendAsRole,
  type LifecycleAction,
  type OnchainJobRaw,
  type PreparedTx,
  type VenueRole,
} from "../lib/venue/lifecycle";
import { recordVenueEvent } from "../services/venue-events";

export interface LifecycleDeps {
  network: () => VenueNetwork;
  onchainJob: (id: number, net: VenueNetwork) => Promise<unknown>;
  /**
   * Server-sign sender (tests inject). Returns tx hashes, or null when the
   * role is not allowed / no key. Default: lifecycle.sendAsRole.
   */
  sendTx?: (role: VenueRole, txs: PreparedTx[], net: VenueNetwork) => Promise<Hex[] | null>;
}

const PHASE_BY_ACTION: Partial<Record<LifecycleAction, keyof VenueJob["chainTxs"]>> = {
  claim: "claimed",
  fund: "funded",
  submit: "submitted",
  complete: "completed",
  reject: "rejected",
  refund: "refunded",
};

interface GateOk {
  job: VenueJob;
  raw: OnchainJobRaw;
  status: string;
  onchainId: bigint;
}

/** Shared pre-checks: job exists, onchain id known, status pulled. */
async function loadJobState(
  c: Context,
  deps: LifecycleDeps,
): Promise<GateOk | Response> {
  const job = getJob(c.req.param("id") ?? "");
  if (!job) {
    return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown jobId");
  }
  if (job.onchainJobId == null) {
    return errorResponse(c, 409, ErrorCodes.INVALID_STATE,
      "job has no onchainJobId — broadcast createJob then attach tx (phase=created)");
  }
  const raw = (await deps.onchainJob(job.onchainJobId, deps.network())) as OnchainJobRaw | null;
  if (!raw) {
    return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR,
      "onchain getJob read failed — retry");
  }
  const status = ERC8183_STATUS[raw.status] ?? "open";
  return { job, raw, status, onchainId: BigInt(job.onchainJobId) };
}

export function registerLifecycleRoutes(app: Hono, deps: LifecycleDeps): void {
  const net = deps.network;
  const sendTx = deps.sendTx ?? ((role: VenueRole, txs: PreparedTx[], n: VenueNetwork) =>
    sendAsRole(role, txs, n.chain.rpcUrl));

  /**
   * Shared handler: sign → load onchain state → transition gate →
   * actor check → sign-mode dispatch → store sync + event.
   */
  async function handleAction(
    c: Context,
    action: LifecycleAction,
    build: (body: Record<string, unknown>, g: GateOk) => { txs: PreparedTx[]; extra?: Record<string, unknown> } | Response,
  ): Promise<Response> {
    const s = await signedJson(c);
    if (s instanceof Response) return s;
    const { body } = s;
    const g = await loadJobState(c, deps);
    if (g instanceof Response) return g;
    const expiredPast =
      g.raw.expiredAt != null && BigInt(g.raw.expiredAt) < BigInt(Math.floor(Date.now() / 1000));
    const check = assertTransition(g.status, action, expiredPast);
    if (!check.ok) {
      return errorResponse(c, 409, ErrorCodes.INVALID_STATE,
        `${check.reason}; onchain status: ${check.current}`);
    }
    let role = ACTION_ROLE[action];
    // reject is evaluator on funded/submitted, but client may cancel own Open job.
    if (action === "reject" && g.status === "open") role = "client";
    if (!actorAllowed(role, s.wallet, g.job, g.raw)) {
      return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
        `signer must be the job ${role}`);
    }
    const built = build(body, g);
    if (built instanceof Response) return built;
    if (built.txs.length === 0) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
        "action requires parameters (e.g. budgetUsdc for claim/fund)");
    }
    if (body.sign === "server") {
      const hashes = await sendTx(role as VenueRole, built.txs, net());
      if (!hashes) {
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
          `server-sign unavailable for role ${role} — use sign:"calldata"`);
      }
      const phase = PHASE_BY_ACTION[action];
      if (phase) g.job.chainTxs[phase] = hashes[hashes.length - 1];
      g.job.status = RESULT_STATUS[action] as VenueJob["status"];
      if (action === "claim") g.job.provider = s.wallet;
      upsertJob(g.job);
      recordVenueEvent({
        action: `job.${action}`,
        text: `job ${g.job.jobId} — ${action} via server EOA (${role})`,
        jobId: g.job.jobId,
        tx: hashes[hashes.length - 1],
        dedupeKey: `job.${action}:${g.job.jobId}`,
      });
      logger.info("venue lifecycle server-sign", { jobId: g.job.jobId, action, hashes });
      return c.json({ job: g.job, mode: "server", txHashes: hashes, onchain: g.status });
    }
    return c.json({
      job: g.job,
      mode: "calldata",
      txs: built.txs,
      onchain: g.status,
      note: `Broadcast txs in order, then GET /api/venue/jobs/${g.job.jobId}/status to sync.`,
      ...built.extra,
    });
  }

  // POST /api/venue/jobs/:id/claim — provider self-assigns + optional setBudget.
  app.post("/api/venue/jobs/:id/claim", dr("Provider claims job (setBudget)"), (c) =>
    handleAction(c, "claim", (body, g) => {
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
      };
    }),
  );

  // POST /api/venue/jobs/:id/fund — client: approve + fund calldata.
  app.post("/api/venue/jobs/:id/fund", dr("Client funds escrow (approve+fund)"), (c) =>
    handleAction(c, "fund", (body, g) => ({
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
    handleAction(c, "submit", (body) => {
      const deliverable = str(body.deliverable, 2048);
      if (!deliverable) {
        return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
          "deliverable required — bytes32 hex or URI/text to hash");
      }
      return {
        txs: buildActionTxs(net(), "submit", {
          onchainJobId: BigInt(getJob(c.req.param("id"))!.onchainJobId!),
          deliverable: deliverableHash(deliverable),
        }),
        extra: { deliverableHash: deliverableHash(deliverable) },
      };
    }),
  );

  // POST /api/venue/jobs/:id/evaluate — evaluator verdict → complete|reject.
  app.post("/api/venue/jobs/:id/evaluate", dr("Evaluator verdict → complete|reject"), (c) =>
    handleAction(c, "complete", (body) => {
      const verdict = str(body.verdict, 10);
      const reason = str(body.reason, 500);
      const reasonHex = reason
        ? keccak256(toBytes(reason))
        : undefined;
      const job = getJob(c.req.param("id"));
      if (verdict === "reject") {
        const txs = buildActionTxs(net(), "reject", {
          onchainJobId: BigInt(job!.onchainJobId!),
          reason: reasonHex,
        });
        if (job) job.verdict = `rejected${reason ? `: ${reason}` : ""}`;
        return { txs };
      }
      if (job) job.verdict = `approved${reason ? `: ${reason}` : ""}`;
      return {
        txs: buildActionTxs(net(), "complete", {
          onchainJobId: BigInt(job!.onchainJobId!),
          reason: reasonHex,
        }),
      };
    }),
  );

  // POST /api/venue/jobs/:id/reject — evaluator (funded/submitted) or client (open).
  app.post("/api/venue/jobs/:id/reject", dr("Reject job → escrow refund"), (c) =>
    handleAction(c, "reject", (body) => {
      const reason = str(body.reason, 500);
      return {
        txs: buildActionTxs(net(), "reject", {
          onchainJobId: BigInt(getJob(c.req.param("id"))!.onchainJobId!),
          reason: reason ? keccak256(toBytes(reason)) : undefined,
        }),
      };
    }),
  );

  // POST /api/venue/jobs/:id/refund — client claims refund on expired job.
  app.post("/api/venue/jobs/:id/refund", dr("Claim refund (expired)"), (c) =>
    handleAction(c, "refund", () => ({
      txs: buildActionTxs(net(), "refund", {
        onchainJobId: BigInt(getJob(c.req.param("id"))!.onchainJobId!),
      }),
    })),
  );

  // GET /api/venue/jobs/:id — merged store + onchain tuple + verdict.
  app.get("/api/venue/jobs/:id", dr("Job detail (store + onchain merge)"), async (c) => {
    const job = getJob(c.req.param("id"));
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
    }
    return c.json({ job, onchain: raw });
  });
}
