/**
 * SLICE-206-6: agent-contour bid + deliverable records (D-206-7 host =
 * market lifecycle; bids/awards are new entities mapped onto it).
 *
 * SaSame semantics: several agents bid → task owner awards ONE bid →
 * the award maps to the lifecycle `claim` commit (claimerDid = winning
 * bidder's wallet). Bid is therefore a separate entity, not a claim.
 *
 * Deliverables keep full evidence_refs + summary per submission —
 * task.resultBody only carries the latest summary, so the store is the
 * complete delivery history (RE-Submission after REVISE is preserved).
 *
 * In-memory for now, same pattern as contract-guards idempotentWrite —
 * no @agentbadge/database for the agent contour yet (tracked with the
 * 206-9 repo question).
 */
import { z } from "zod";
import { evidenceRefsSchema, summarySchema } from "../contract-guards";

export const bidBodySchema = z.object({
  price: z.number().nonnegative().optional(), // counter-offer vs task budget
  eta_seconds: z.number().int().positive().optional(),
  note: summarySchema.optional(),
});
export type BidBody = z.infer<typeof bidBodySchema>;

export interface BidRecord {
  bid_id: string;
  task_id: string;
  bidder_wallet: string;
  price?: number;
  eta_seconds?: number;
  note?: string;
  status: "submitted" | "awarded" | "rejected" | "withdrawn";
  submitted_at: string;
}

export const awardBodySchema = z.object({
  bid_id: z.string().min(1),
});
export type AwardBody = z.infer<typeof awardBodySchema>;

export const deliverableBodySchema = z.object({
  summary: summarySchema,
  evidence_refs: evidenceRefsSchema.optional(),
  result_ipfs: z.string().max(500).optional(),
});
export type DeliverableBody = z.infer<typeof deliverableBodySchema>;

export interface DeliverableRecord {
  deliverable_id: string;
  task_id: string;
  worker_wallet: string;
  summary: string;
  evidence_refs: string[];
  result_ipfs?: string;
  submitted_at: string;
}

// ─── Stores ──────────────────────────────────────────────────────

const bidsByTask = new Map<string, BidRecord[]>();
const deliverablesByTask = new Map<string, DeliverableRecord[]>();
let seq = 0;

function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function listBids(taskId: string): BidRecord[] {
  return bidsByTask.get(taskId) ?? [];
}

export function getBid(taskId: string, bidId: string): BidRecord | undefined {
  return listBids(taskId).find((b) => b.bid_id === bidId);
}

/** One active bid per wallet per task (spam guard). */
export function addBid(taskId: string, wallet: string, body: BidBody): BidRecord {
  const record: BidRecord = {
    bid_id: nextId("bid"),
    task_id: taskId,
    bidder_wallet: wallet.toLowerCase(),
    price: body.price,
    eta_seconds: body.eta_seconds,
    note: body.note,
    status: "submitted",
    submitted_at: new Date().toISOString(),
  };
  const list = bidsByTask.get(taskId) ?? [];
  list.push(record);
  bidsByTask.set(taskId, list);
  return record;
}

export function hasActiveBid(taskId: string, wallet: string): boolean {
  return listBids(taskId).some(
    (b) => b.bidder_wallet === wallet.toLowerCase() && b.status === "submitted",
  );
}

export function markAwarded(taskId: string, bidId: string): BidRecord | null {
  const bid = getBid(taskId, bidId);
  if (!bid || bid.status !== "submitted") return null;
  bid.status = "awarded";
  for (const other of listBids(taskId)) {
    if (other.bid_id !== bidId && other.status === "submitted") {
      other.status = "rejected";
    }
  }
  return bid;
}

export function listDeliverables(taskId: string): DeliverableRecord[] {
  return deliverablesByTask.get(taskId) ?? [];
}

export function addDeliverable(
  taskId: string,
  wallet: string,
  body: DeliverableBody,
): DeliverableRecord {
  const record: DeliverableRecord = {
    deliverable_id: nextId("dlv"),
    task_id: taskId,
    worker_wallet: wallet.toLowerCase(),
    summary: body.summary,
    evidence_refs: body.evidence_refs ?? [],
    result_ipfs: body.result_ipfs,
    submitted_at: new Date().toISOString(),
  };
  const list = deliverablesByTask.get(taskId) ?? [];
  list.push(record);
  deliverablesByTask.set(taskId, list);
  return record;
}

/** Test seam — clears bids + deliverables between runs. */
export function resetBidStoresForTesting(): void {
  bidsByTask.clear();
  deliverablesByTask.clear();
}
