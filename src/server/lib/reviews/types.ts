/**
 * EPIC-230 (SLICE-230-1, D-230-1/5..8): review domain types.
 *
 * Store implementations (Postgres adapter / in-memory) share these
 * record shapes — DB rows are mapped at the adapter boundary
 * (knowledge/types.ts precedent). Timestamps are ISO strings.
 */

import { REVIEW_EVIDENCE_CAP } from "@agentbadge/database";

/** Single source for the ≤50 evidence cap (D-230-7) — the db
 *  package exports it; memory + PG enforce the same bound. */
export { REVIEW_EVIDENCE_CAP };

/** D-230-5 lifecycle. */
export const REVIEW_STATUSES = [
  "PENDING_TRIAGE",
  "IN_REVIEW",
  "DECIDED",
  "DECLINED",
  "REOPENED",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Legal from→to table — enforced INSIDE the store on BOTH backends
 * (Arc R4 M-4 lesson). PENDING_TRIAGE→DECIDED is NOT a legal direct
 * jump: decideReview owns that edge so the append-only decision row
 * always lands with the flip.
 */
export const REVIEW_TRANSITIONS: Readonly<
  Record<ReviewStatus, ReadonlySet<ReviewStatus>>
> = {
  PENDING_TRIAGE: new Set(["IN_REVIEW", "DECLINED"]),
  IN_REVIEW: new Set(["DECIDED", "DECLINED"]),
  DECIDED: new Set(["REOPENED"]),
  DECLINED: new Set(),
  REOPENED: new Set(["PENDING_TRIAGE"]),
};

/** D-230-5 DECLINED needs a reason — closed vocabulary. */
export const REVIEW_DECLINE_REASONS = [
  "OUT_OF_SCOPE",
  "SPAM",
  "INSUFFICIENT_EVIDENCE",
  "DUPLICATE",
  "OTHER",
] as const;
export type ReviewDeclineReason = (typeof REVIEW_DECLINE_REASONS)[number];

/** D-230-6 review types — platform criteria templates hang off these. */
export const REVIEW_TYPES = [
  "API_SURFACE",
  "DOCS",
  "CODE_SNIPPET",
  "INTEGRATION",
  "OTHER",
] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

/** D-230-7 evidence types + sides. */
export const REVIEW_EVIDENCE_TYPES = [
  "EXTERNAL_URL",
  "API_ENDPOINT",
  "ONCHAIN_TX",
  "REPO_LINK",
  "ARTIFACT_REF",
  "OTHER",
] as const;
export type ReviewEvidenceType = (typeof REVIEW_EVIDENCE_TYPES)[number];
export const REVIEW_SUBMITTED_BY = ["AGENT", "OPERATOR"] as const;
export type ReviewSubmittedBy = (typeof REVIEW_SUBMITTED_BY)[number];

/** D-230-8 decision outcomes + per-criterion results (D-230-6). */
export const REVIEW_DECISION_OUTCOMES = [
  "APPROVED",
  "APPROVED_WITH_NOTES",
  "CHANGES_REQUESTED",
  "REJECTED",
] as const;
export type ReviewDecisionOutcome =
  (typeof REVIEW_DECISION_OUTCOMES)[number];
export const CRITERION_RESULTS = ["PASS", "FAIL", "NA"] as const;
export type CriterionResult = (typeof CRITERION_RESULTS)[number];

/** Append-only event log kinds (D-230-1, §11.2 names). */
export const REVIEW_EVENT_KINDS = [
  "review.submitted",
  "review.claimed",
  "review.decided",
  "review.declined",
  "review.reopened",
  "review.returned",
  "review.evidence_added",
  "review.knowledge_converted",
] as const;
export type ReviewEventKind = (typeof REVIEW_EVENT_KINDS)[number];

export interface ReviewCaseRecord {
  id: string;
  actorResolution: string;
  actorRef: string | null;
  dedupeScope: string;
  idempotencyKey: string | null;
  reviewType: string;
  /** URI of the work under review (validated at the edge). */
  workRef: string;
  /** Agent free-text criteria wishes — shown to the operator, never
   *  part of the platform scoring structure (D-230-6). */
  agentCriteria: unknown | null;
  status: string;
  /** Operator ref — set on PENDING_TRIAGE→IN_REVIEW (claim). */
  assignee: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  /** D-230-9: delivery is automatic at DECIDED (poll-only). */
  deliveredAt: string | null;
  declineReason: string | null;
  /** §17.3 metric — increments on DECIDED→REOPENED. */
  reopenCount: number;
  /** Pointer into the append-only ReviewDecision log (D-230-8). */
  latestDecisionSeq: number | null;
  knowledgeConverted: boolean;
  knowledgeItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewEvidenceRecord {
  id: string;
  reviewId: string;
  type: string;
  uri: string;
  label: string | null;
  description: string | null;
  submittedBy: string;
  createdAt: string;
}

export interface ReviewDecisionRecord {
  id: string;
  reviewId: string;
  seq: number;
  outcome: string;
  /** Per-criterion snapshot: [{key,result,note?}] (D-230-6). */
  criteriaResults: unknown;
  summary: string;
  decidedBy: string;
  decidedAt: string;
}

export interface ReviewEventRecord {
  id: string;
  reviewId: string;
  seq: number;
  kind: string;
  visibility: string;
  payload: unknown;
  createdAt: string;
}
