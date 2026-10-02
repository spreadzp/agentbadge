/**
 * SLICE-152-2/3: lifecycle route internals — shared handler machinery.
 * Routes live in venue-api-lifecycle.ts; the signed→onchain-gate→
 * sign-mode dispatch pipeline lives here (max-lines split).
 */
import type { Context } from "hono";
import type { Hex } from "viem";
import { logger } from "@agentbadge/passport";
import { getJob, upsertJob, type VenueJob } from "../lib/venue/store";
import type { VenueNetwork } from "../lib/venue/chain";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { signedJson, ERC8183_STATUS } from "./venue-api-helpers";
import {
  ACTION_ROLE,
  RESULT_STATUS,
  actorAllowed,
  assertTransition,
  type LifecycleAction,
  type OnchainJobRaw,
  type PreparedTx,
  type VenueRole,
} from "../lib/venue/lifecycle";
import { recordVenueEvent } from "../services/venue-events";
import { getVenue, venueIdOf } from "../lib/venue/venues";
import { venueHasRole } from "../lib/venue/members";
import {
  ensureVenueFeedback,
  type FeedbackSender,
} from "../lib/venue/reputation-loop";
import {
  buildFeeSweepTx,
  feeQuote,
  resolveFeeMode,
  venueEconomics,
} from "../lib/venue/economics";

const PHASE_BY_ACTION: Partial<Record<LifecycleAction, keyof VenueJob["chainTxs"]>> = {
  claim: "claimed",
  fund: "funded",
  submit: "submitted",
  complete: "completed",
  reject: "rejected",
  refund: "refunded",
};

export interface LifecycleDeps {
  network: () => VenueNetwork;
  onchainJob: (id: number, net: VenueNetwork) => Promise<unknown>;
  /** Resolve onchainJobId from a confirmed createJob tx receipt. */
  txJobId?: (txHash: `0x${string}`, net: VenueNetwork) => Promise<number | null>;
  /**
   * Server-sign sender (tests inject). Returns tx hashes, or null when the
   * role is not allowed / no key. Default: lifecycle.sendAsRole.
   */
  sendTx?: (role: VenueRole, txs: PreparedTx[], net: VenueNetwork) => Promise<Hex[] | null>;
  /** Reputation feedback sender (152-3) — injectable for tests. */
  sendFeedback?: FeedbackSender;
  /** Provider/client agentId resolvers for feedback (152-3). */
  providerAgentId?: (job: VenueJob, net: VenueNetwork) => Promise<number | null>;
  clientAgentId?: (job: VenueJob, net: VenueNetwork) => Promise<number | null>;
}

export interface GateOk {
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

export interface BuiltAction {
  txs: PreparedTx[];
  extra?: Record<string, unknown>;
  /** Store mutations applied in both sign modes (deliverableHash, agentId…). */
  mutate?: (job: VenueJob, wallet: string) => void;
  /** Overrides RESULT_STATUS[action] (evaluate may return "rejected"). */
  status?: VenueJob["status"];
  /** Overrides PHASE_BY_ACTION[action] for chainTxs. */
  phase?: keyof VenueJob["chainTxs"];
}

export interface ActionCtx {
  deps: LifecycleDeps;
  net: () => VenueNetwork;
  sendTx: NonNullable<LifecycleDeps["sendTx"]>;
}

/** 152-3: send ERC-8004 feedback once a job lands in a terminal status. */
export async function maybeFeedback(
  job: VenueJob,
  ctx: Pick<ActionCtx, "deps" | "net">,
): Promise<string | undefined> {
  if (job.status !== "completed" && job.status !== "rejected") return undefined;
  return ensureVenueFeedback(
    job.jobId,
    { verdict: job.status, deliverableHash: job.deliverableHash },
    {
      network: ctx.net,
      sendFeedback: ctx.deps.sendFeedback,
      providerAgentId: ctx.deps.providerAgentId,
      clientAgentId: ctx.deps.clientAgentId,
    },
  );
}

/**
 * 152-4: post-settlement take-rate sweep. Only for feeMode="sweep"
 * (provider is a server EOA) — USDC transfer to treasury signed as
 * provider. Idempotent via job.fee.status gate.
 */
export async function maybeFeeSweep(
  job: VenueJob,
  ctx: ActionCtx,
): Promise<string | undefined> {
  if (job.status !== "completed") return undefined;
  // 153-5: venue-aware economics — per-venue override / subscriber rate.
  const econ = venueEconomics(getVenue(venueIdOf(job)));
  if (!job.feeMode) {
    job.feeMode = resolveFeeMode(job, econ, ctx.net());
    upsertJob(job);
  }
  if (job.feeMode !== "sweep") {
    if (job.feeMode === "none" && !job.fee) {
      job.fee = {
        bps: 0, amountAtomic: "0",
        providerAtomic: "", treasury: "",
        status: "skipped", reason: "feeMode=none (external provider, no hook)",
      };
      upsertJob(job);
    }
    return job.fee?.status;
  }
  if (job.fee?.status === "swept" || job.fee?.status === "failed") {
    return job.fee.status;
  }
  const q = feeQuote(job.budgetUsdc, econ, "sweep");
  const tx = buildFeeSweepTx(job, econ, ctx.net());
  if (!tx || !econ.treasury) {
    job.fee = {
      bps: q.feeBps, amountAtomic: "0", providerAtomic: q.providerAtomic,
      treasury: "", status: "skipped", reason: "no treasury configured",
    };
    upsertJob(job);
    return "skipped";
  }
  job.fee = {
    bps: q.feeBps, amountAtomic: q.feeAtomic, providerAtomic: q.providerAtomic,
    treasury: econ.treasury, status: "pending",
  };
  upsertJob(job);
  try {
    const hashes = await ctx.sendTx("provider", [tx], ctx.net());
    if (hashes?.[0]) {
      job.fee.status = "swept";
      job.fee.tx = hashes[0];
      recordVenueEvent({
        action: "job.fee",
        text: `job ${job.jobId} — take rate ${q.feeBps}bps swept to treasury`,
        jobId: job.jobId,
        tx: hashes[0],
        dedupeKey: `job.fee:${job.jobId}`,
      });
      logger.info("venue fee swept", { jobId: job.jobId, tx: hashes[0], feeBps: q.feeBps });
    } else {
      job.fee.status = "skipped";
      job.fee.reason = "no provider server signer";
    }
  } catch (e) {
    job.fee.status = "failed";
    job.fee.reason = e instanceof Error ? e.message : String(e);
    logger.warn("venue fee sweep failed", { jobId: job.jobId, error: job.fee.reason });
  }
  upsertJob(job);
  return job.fee.status;
}

/**
 * Shared handler: sign → load onchain state → transition gate →
 * actor check → sign-mode dispatch → store sync + event.
 */
export async function handleAction(
  c: Context,
  ctx: ActionCtx,
  action: LifecycleAction,
  build: (body: Record<string, unknown>, g: GateOk) => BuiltAction | Response,
): Promise<Response> {
  const { deps, net, sendTx } = ctx;
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
  // 153-2: business-venue jobs additionally require provider+ membership
  // for claim/submit (job-scoped actions; posting uses clientPolicy).
  if (action === "claim" || action === "submit") {
    const v = getVenue(venueIdOf(g.job));
    if (v?.kind === "business" && !venueHasRole(v, s.wallet, "provider")) {
      return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
        "signer is not a venue provider");
    }
  }
  const built = build(body, g);
  if (built instanceof Response) return built;
  if (built.txs.length === 0) {
    return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
      "action requires parameters (e.g. budgetUsdc for claim/fund)");
  }
  // Optimistic store mutations apply in both sign modes.
  built.mutate?.(g.job, s.wallet);
  if (body.sign === "server") {
    const hashes = await sendTx(role as VenueRole, built.txs, net());
    if (!hashes) {
      return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
        `server-sign unavailable for role ${role} — use sign:"calldata"`);
    }
    const phase = built.phase ?? PHASE_BY_ACTION[action];
    if (phase) g.job.chainTxs[phase] = hashes[hashes.length - 1];
    g.job.status = (built.status ?? RESULT_STATUS[action]) as VenueJob["status"];
    upsertJob(g.job);
    recordVenueEvent({
      action: `job.${action}`,
      text: `job ${g.job.jobId} — ${action} via server EOA (${role})`,
      jobId: g.job.jobId,
      tx: hashes[hashes.length - 1],
      dedupeKey: `job.${action}:${g.job.jobId}`,
    });
    logger.info("venue lifecycle server-sign", { jobId: g.job.jobId, action, hashes });
    // 152-4: take-rate sweep first (money), then the feedback loop.
    const feeStatus = await maybeFeeSweep(g.job, ctx);
    // 152-3: terminal verdicts trigger the objective feedback loop.
    const feedbackStatus = await maybeFeedback(g.job, ctx);
    return c.json({
      job: g.job,
      mode: "server",
      txHashes: hashes,
      onchain: g.status,
      feedbackStatus,
      feeStatus,
    });
  }
  upsertJob(g.job);
  return c.json({
    job: g.job,
    mode: "calldata",
    txs: built.txs,
    onchain: g.status,
    note: `Broadcast txs in order, then GET /api/venue/jobs/${g.job.jobId}/status to sync.`,
    ...built.extra,
  });
}
