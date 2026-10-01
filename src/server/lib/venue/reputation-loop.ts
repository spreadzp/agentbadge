/**
 * SLICE-152-3: reputation loop sender — post-complete hook.
 *
 * Called from the evaluate route after a verdict lands (server-sign) and
 * on GET /jobs/:id when onchain status first reaches completed|rejected
 * (covers calldata mode where the evaluator broadcasts themselves).
 *
 * Flow: job.feedback.status gate → resolve provider agentId →
 * composeFeedback + buildFeedbackTx (memo-wrapped giveFeedback) →
 * send via evaluator server signer (≤3 attempts) → store outcome.
 * ARC_VENUE_RATE_CLIENTS=1 additionally rates the client (tag1=venue-client).
 */
import { logger } from "@agentbadge/passport";
import { getJob, upsertJob, type VenueJob } from "./store";
import type { VenueNetwork } from "./chain";
import type { PreparedTx } from "./lifecycle";
import { sendAsRole } from "./lifecycle-sign";
import {
  buildFeedbackTx,
  composeFeedback,
  type FeedbackReport,
} from "./reputation";
import { recordVenueEvent } from "../../services/venue-events";

export type FeedbackSender = (
  txs: PreparedTx[],
  net: VenueNetwork,
) => Promise<`0x${string}`[] | null>;

export interface ReputationDeps {
  network: () => VenueNetwork;
  /** Server-sign sender for evaluator EOA — injectable for tests. */
  sendFeedback?: FeedbackSender;
  /** Provider agentId resolver (wallet → ERC-8004 id); store field wins. */
  providerAgentId?: (job: VenueJob, net: VenueNetwork) => Promise<number | null>;
  /** Optional client agentId resolver for ARC_VENUE_RATE_CLIENTS=1. */
  clientAgentId?: (job: VenueJob, net: VenueNetwork) => Promise<number | null>;
  attempts?: number;
}

function mark(job: VenueJob, feedback: VenueJob["feedback"]): void {
  job.feedback = feedback;
  upsertJob(job);
}

/**
 * Ensure reputation feedback is sent for a terminal job.
 * Returns final feedback status. No-op ("sent"/"skipped") callers get the
 * stored status back without touching the chain.
 */
export async function ensureVenueFeedback(
  jobId: string,
  report: FeedbackReport,
  deps: ReputationDeps,
): Promise<"sent" | "failed" | "skipped" | "pending"> {
  const job = getJob(jobId);
  if (!job) return "skipped";
  if (job.feedback?.status === "sent" || job.feedback?.status === "skipped") {
    return job.feedback.status;
  }
  const net = deps.network();
  if (report.verdict !== "completed" && report.verdict !== "rejected") {
    return "pending";
  }

  const agentId =
    job.providerAgentId ??
    (deps.providerAgentId ? await deps.providerAgentId(job, net) : null);
  if (agentId == null) {
    mark(job, {
      status: "skipped",
      reason: "provider has no ERC-8004 agentId — enable mirroring or pass providerAgentId",
    });
    logger.info("venue feedback skipped — no provider agentId", {
      jobId: job.jobId,
    });
    return "skipped";
  }

  const send: FeedbackSender =
    deps.sendFeedback ??
    ((txs, n) => sendAsRole("evaluator", txs, n.chain.rpcUrl));
  const fb = composeFeedback(job, report, BigInt(agentId));
  const txs = [buildFeedbackTx(net, fb, job)];

  // Optional client rating (D7 second channel — off by default).
  if (process.env.ARC_VENUE_RATE_CLIENTS === "1") {
    const clientId =
      job.clientAgentId ??
      (deps.clientAgentId ? await deps.clientAgentId(job, net) : null);
    if (clientId != null) {
      const clientFb = composeFeedback(job, report, BigInt(clientId), "venue-client");
      txs.push(buildFeedbackTx(net, clientFb, job));
    }
  }

  const attempts = deps.attempts ?? 3;
  let hashes: `0x${string}`[] | null = null;
  for (let i = 0; i < attempts && !hashes; i++) {
    try {
      hashes = await send(txs, net);
    } catch (e) {
      logger.warn("venue feedback send failed", {
        jobId: job.jobId,
        attempt: i + 1,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (!hashes || hashes.length === 0) {
    mark(job, {
      status: "failed",
      reason: `send failed after ${attempts} attempts — no evaluator key or RPC error`,
      feedbackURI: fb.feedbackURI,
    });
    return "failed";
  }
  mark(job, {
    status: "sent",
    txHash: hashes[0],
    feedbackURI: fb.feedbackURI,
  });
  recordVenueEvent({
    action: "job.feedback",
    text: `job ${job.jobId} — reputation feedback sent (agentId=${agentId}, value=${fb.value})`,
    jobId: job.jobId,
    tx: hashes[0],
    dedupeKey: `job.feedback:${job.jobId}`,
  });
  logger.info("venue reputation feedback sent", {
    jobId: job.jobId,
    txHash: hashes[0],
    agentId: Number(agentId),
  });
  return "sent";
}
