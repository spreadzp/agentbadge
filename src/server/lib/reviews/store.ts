import type {
  ReviewCaseRecord,
  ReviewDecisionRecord,
  ReviewEventRecord,
  ReviewEvidenceRecord,
} from "./types";

/**
 * EPIC-230 (SLICE-230-1, D-230-5..8): review store contract — the
 * Postgres adapter and the in-memory store share semantics
 * (interaction-store.ts precedent).
 *
 * MUST share:
 * - submitReview is atomic: dedupe probe on (idempotencyKey,
 *   dedupeScope), case insert, initial AGENT evidence rows and
 *   received events land as ONE unit. Replay → duplicate:true, no
 *   writes.
 * - The status machine is enforced inside the store (Arc R4 M-4):
 *   refuses illegal jumps and writes NOTHING on refusal. Effects
 *   derive from `to`: IN_REVIEW stamps assignee/claimedAt from the
 *   ACTOR; DECLINED requires declineReason; REOPENED increments
 *   reopenCount + clears decidedAt/deliveredAt; REOPENED→
 *   PENDING_TRIAGE releases the claim.
 * - addEvidence gates on submittedBy under the lock: AGENT rows only
 *   while PENDING_TRIAGE, OPERATOR rows only while IN_REVIEW; the
 *   ≤50 cap is re-checked inside the same unit.
 * - decideReview is atomic: decision seq = max+1, case flips to
 *   DECIDED with auto-delivery stamps (decidedAt = deliveredAt) and
 *   latestDecisionSeq. A refused decide writes NOTHING.
 * - Decisions and events are append-only — no update/delete.
 */

export interface ReviewSubmitInput {
  id: string;
  actorResolution: string;
  actorRef?: string | null;
  dedupeScope: string;
  idempotencyKey?: string | null;
  reviewType: string;
  workRef: string;
  agentCriteria?: unknown | null;
}

export interface ReviewEvidenceInsert {
  id: string;
  reviewId: string;
  type: string;
  uri: string;
  label?: string | null;
  description?: string | null;
  submittedBy: string;
}

export interface ReviewEventInput {
  id?: string;
  kind: string;
  visibility: string;
  payload: unknown;
}

export interface ReviewTransitionInput {
  from: string;
  to: string;
  actor: string;
  reason?: string | null;
  /** Required when to=DECLINED (D-230-5 enum). */
  declineReason?: string | null;
  /** ISO timestamp for effect columns (claimedAt etc.). */
  now?: string;
}

export interface ReviewDecideInput {
  outcome: string;
  criteriaResults: unknown;
  summary: string;
  /** Validated operator ref (allowlist at the edge). */
  decidedBy: string;
  now?: string;
}

export type ReviewTransitionResult =
  | {
      record: ReviewCaseRecord;
      event: ReviewEventRecord;
      transitioned: true;
    }
  | {
      record: ReviewCaseRecord | null;
      event: null;
      transitioned: false;
      reason:
        | "missing"
        | "status_mismatch"
        | "illegal"
        | "precondition_required";
    };

export type ReviewDecideResult =
  | {
      record: ReviewCaseRecord;
      decision: ReviewDecisionRecord;
      event: ReviewEventRecord;
      transitioned: true;
    }
  | {
      record: ReviewCaseRecord | null;
      decision: null;
      event: null;
      transitioned: false;
      reason: "missing" | "status_mismatch";
    };

export interface ReviewListOpts {
  status?: string;
  reviewType?: string;
  assignee?: string;
  limit?: number;
  offset?: number;
}

export interface ReviewStore {
  readonly backend: "postgres" | "memory";

  getReview(id: string): Promise<ReviewCaseRecord | null>;
  findByIdempotency(
    idempotencyKey: string,
    dedupeScope: string,
  ): Promise<ReviewCaseRecord | null>;

  /** Operator queue — FIFO by createdAt, offset pagination. */
  listReviews(opts?: ReviewListOpts): Promise<ReviewCaseRecord[]>;

  /**
   * Fresh case + initial evidence + received events — atomic.
   * (idempotencyKey, dedupeScope) replay → duplicate:true, no writes.
   */
  submitReview(
    input: ReviewSubmitInput,
    evidence: ReviewEvidenceInsert[],
    events: ReviewEventInput[],
  ): Promise<{ record: ReviewCaseRecord; duplicate: boolean }>;

  /**
   * Two-sided evidence append (D-230-7): AGENT rows only while
   * PENDING_TRIAGE, OPERATOR rows only while IN_REVIEW; cap ≤50
   * re-checked inside the unit. Refusal writes NOTHING.
   */
  addEvidence(
    reviewId: string,
    rows: ReviewEvidenceInsert[],
    event?: ReviewEventInput,
  ): Promise<
    | { ok: true; added: ReviewEvidenceRecord[] }
    | {
        ok: false;
        reason: "missing" | "not_editable" | "cap_exceeded";
      }
  >;
  listEvidence(reviewId: string): Promise<ReviewEvidenceRecord[]>;

  /** Status machine inside the store lock — see contract notes. */
  transitionReview(
    id: string,
    input: ReviewTransitionInput,
    event: ReviewEventInput,
  ): Promise<ReviewTransitionResult>;

  /**
   * Append-only decision + case flip to DECIDED + auto-delivery —
   * ONE unit. seq = max+1 under the lock (D-230-8).
   */
  decideReview(
    id: string,
    input: ReviewDecideInput,
    event: ReviewEventInput,
  ): Promise<ReviewDecideResult>;
  listDecisions(reviewId: string): Promise<ReviewDecisionRecord[]>;

  appendEvents(
    reviewId: string,
    events: ReviewEventInput[],
  ): Promise<ReviewEventRecord[]>;
  listEvents(
    reviewId: string,
    opts?: { visibility?: string },
  ): Promise<ReviewEventRecord[]>;

  /** D-230-10 seam — sets knowledgeConverted + knowledgeItemId. */
  markKnowledgeConverted(
    id: string,
    knowledgeItemId: string,
    event: ReviewEventInput,
  ): Promise<ReviewCaseRecord | null>;
}
