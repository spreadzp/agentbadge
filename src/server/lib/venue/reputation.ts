/**
 * SLICE-152-3: reputation loop — objective feedback channel (D7).
 *
 * When a venue job reaches Completed|Rejected onchain, the evaluator EOA
 * writes ERC-8004 giveFeedback for the provider's agentId — wrapped in
 * memo(reputationRegistry, giveFeedbackCalldata, jobHash, contextJson)
 * so the feedback + Memo event land in ONE tx (D2-152).
 *
 * Idempotent: job.feedback.status "sent" → never resends (memoId is
 * jobId-derived, so a retry duplicates anyway — we guard in the store).
 * No provider agentId → status "skipped" + reason. The evaluator is NOT
 * the agent owner by construction, so the contract's self-feedback
 * revert can't trigger.
 */
import { encodeFunctionData, keccak256, toBytes, toHex, type Hex } from "viem";
import {
  ERC8004_ABI,
  MEMO_ABI,
  memoIdFor,
} from "@agentbadge/circle-payments";
import type { VenueJob } from "./store";
import type { VenueNetwork } from "./chain";
import type { PreparedTx } from "./lifecycle";

export interface FeedbackReport {
  /** "completed" | "rejected" → value +1 / -1 */
  verdict: "completed" | "rejected";
  reason?: string;
  /** "httpCheck" | "offer-fulfillment" | "bstock-deliverable" | "manual" */
  verifyMethod?: string;
  /** bytes32 from submit — binds feedback to the deliverable. */
  deliverableHash?: string;
}

export interface ComposedFeedback {
  agentId: bigint;
  value: bigint;
  decimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackURI: string;
  hash: Hex;
}

const B32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/**
 * Build giveFeedback params for a finished venue job.
 * value=±1, decimals=0 (binary verdict); tag2 carries the verify method
 * so reputation stays objective-by-channel (D7).
 */
export function composeFeedback(
  job: VenueJob,
  report: FeedbackReport,
  agentId: bigint,
  tag = "venue-job",
): ComposedFeedback {
  const payload = {
    schema: "agentbadge.venue-job.v1",
    jobId: job.jobId,
    onchainJobId: job.onchainJobId ?? null,
    verdict: report.verdict,
    reason: report.reason ?? null,
    verifyMethod: report.verifyMethod ?? "manual",
    budgetUsdc: job.budgetUsdc,
    chainTxs: job.chainTxs,
  };
  const feedbackURI =
    `data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
  return {
    agentId,
    value: report.verdict === "completed" ? 1n : -1n,
    decimals: 0,
    tag1: tag,
    tag2: report.verifyMethod ?? "manual",
    endpoint: `/market/jobs/${job.jobId}`,
    feedbackURI,
    hash: report.deliverableHash && /^0x[0-9a-fA-F]{64}$/.test(report.deliverableHash)
      ? (report.deliverableHash as Hex)
      : keccak256(toBytes(JSON.stringify(payload))),
  };
}

/**
 * memo(reputationRegistry, giveFeedbackData, memoId, contextJson) —
 * one PreparedTx; memoId is deterministic per (jobId, tag) so a
 * duplicate send is a no-op onchain AND a tx for the explorer link.
 */
export function buildFeedbackTx(
  net: VenueNetwork,
  fb: ComposedFeedback,
  job: VenueJob,
): PreparedTx {
  const giveFeedbackData = encodeFunctionData({
    abi: ERC8004_ABI,
    functionName: "giveFeedback",
    args: [
      fb.agentId,
      fb.value,
      fb.decimals,
      fb.tag1,
      fb.tag2,
      fb.endpoint,
      fb.feedbackURI,
      fb.hash ?? B32_ZERO,
    ],
  } as never);
  const memoId = memoIdFor("venue-feedback", fb.tag1, job.jobId);
  const context = toHex(JSON.stringify({
    kind: "venue-feedback",
    jobId: job.jobId,
    onchainJobId: job.onchainJobId ?? null,
  }));
  return {
    to: net.memo,
    data: encodeFunctionData({
      abi: MEMO_ABI,
      functionName: "memo",
      args: [net.reputationRegistry, giveFeedbackData, memoId, context],
    } as never),
    description:
      `memo→giveFeedback(agentId=${fb.agentId}, value=${fb.value}, ` +
      `tag=${fb.tag1}) — job ${job.jobId}`,
  };
}
