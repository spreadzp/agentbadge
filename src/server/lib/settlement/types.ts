/**
 * EPIC-227 / SLICE-227-2 — A2A settlement domain types.
 *
 * Settlement layer for agent commerce (D-227-1..8): milestone-structured
 * payment with conditional release, manual-ops PayoutIntent completion
 * behind a real txHash, participant disputes with operator arbitration,
 * and a deterministic settlement receipt + memo anchor (227-4).
 *
 * Boundaries:
 * - payment state ≠ task state — `agreementRef` is an external id, the
 *   domain never imports commerce (slice rule);
 * - money is a decimal string everywhere — never a float;
 * - admin effects go through the shared FinOps AdminAction surface;
 * - no fabricated on-chain confirmation — a leg completes only behind
 *   a real txHash bound set-once.
 */

// ---------- statuses ----------

export const PLAN_STATUSES = [
  "ACTIVE",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const MILESTONE_STATUSES = [
  "PENDING",
  "READY",
  "APPROVED",
  "RELEASED",
  "DISPUTED",
  "CANCELLED",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const INTENT_STATUSES = [
  "OPEN",
  "FROZEN",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const LEG_STATUSES = [
  "OPEN",
  "FROZEN",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type LegStatus = (typeof LEG_STATUSES)[number];

export const DISPUTE_STATUSES = ["OPEN", "RESOLVED"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const ANCHOR_STATUSES = ["PENDING", "ANCHORED", "FAILED"] as const;
export type AnchorStatus = (typeof ANCHOR_STATUSES)[number];

// ---------- controlled vocabularies ----------

/** D-227-3: how a milestone becomes payable. EVALUATOR_VERDICT is a
 *  declared seam — v1 services only drive BUYER_ACCEPT. */
export const RELEASE_POLICIES = [
  "BUYER_ACCEPT",
  "EVALUATOR_VERDICT",
] as const;
export type ReleasePolicy = (typeof RELEASE_POLICIES)[number];

/** D-227-4: who completes payout intents. WALLET_SERVICE is a seam. */
export const EXECUTORS = ["MANUAL", "WALLET_SERVICE"] as const;
export type PayoutExecutor = (typeof EXECUTORS)[number];

/** D-227-5: payout-leg role vocabulary. */
export const LEG_ROLES = [
  "PROVIDER",
  "COLLABORATOR",
  "PLATFORM_FEE",
] as const;
export type LegRole = (typeof LEG_ROLES)[number];

/** D-227-7: dispute subject kinds. */
export const DISPUTE_SUBJECT_TYPES = ["AGREEMENT", "MILESTONE"] as const;
export type DisputeSubjectType = (typeof DISPUTE_SUBJECT_TYPES)[number];

/** Manual arbitration outcomes (D-227-7). */
export const DISPUTE_RESOLUTIONS = [
  "FOR_BUYER",
  "FOR_PROVIDER",
  "SPLIT",
] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

/** Event-stream entity types — distinct namespace inside the shared
 *  append-only event store (no collision with commerce entities). */
export const SETTLEMENT_ENTITY_TYPES = [
  "settlement_plan",
  "milestone",
  "payout_intent",
  "payout_leg",
  "settlement_dispute",
  "settlement_anchor",
] as const;
export type SettlementEntityType = (typeof SETTLEMENT_ENTITY_TYPES)[number];

// ---------- errors ----------

export const SETTLEMENT_ERRORS = [
  "OPERATOR_REQUIRED",
  "EVIDENCE_TOO_LARGE",
  "BAD_INPUT",
  "NOT_FOUND",
  "FORBIDDEN",
  "INVALID_STATE",
  "CONFLICT",
  "TX_UNVERIFIED",
  "TX_REUSED",
  "VERIFIER_UNAVAILABLE",
  "PROVIDER_ERROR",
] as const;
export type SettlementErrorCode = (typeof SETTLEMENT_ERRORS)[number];

export interface SettlementError {
  code: SettlementErrorCode;
  message: string;
}

export type SettlementResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SettlementError };

export const ok = <T>(value: T): SettlementResult<T> => ({
  ok: true,
  value,
});
export const fail = (
  code: SettlementErrorCode,
  message: string,
): SettlementResult<never> => ({ ok: false, error: { code, message } });

// ---------- DTOs ----------

export interface MilestoneInput {
  /** Caller-chosen key — unique within the plan. */
  milestoneId: string;
  title: string;
  /** Decimal string in plan currency — sums must equal totalUsd. */
  amountUsd: string;
  acceptanceCriteria?: string;
  dueAtMs?: number;
  releasePolicy?: ReleasePolicy;
  /**
   * Optional leg template — on APPROVED the intent's legs are built
   * from it; absent → a single PROVIDER leg of the full amount to the
   * provider wallet (D-227-5). Sum must equal amountUsd when present.
   */
  legs?: PayoutLegInput[];
}

export interface PayoutLegInput {
  /** EVM wallet destination. */
  payee: string;
  /** Decimal string — leg sum equals the milestone amount. */
  amountUsdc: string;
  role: LegRole;
}

export interface CreatePlanInput {
  /** External agreement reference — one plan per agreement. */
  agreementRef: string;
  buyerWallet: string;
  providerWallet: string;
  currency?: string;
  /** Decimal string — must equal sum(milestones.amountUsd). */
  totalUsd: string;
  milestones: MilestoneInput[];
}

export interface RaiseDisputeInput {
  subjectType: DisputeSubjectType;
  /** agreementRef (AGREEMENT) | milestone row id (MILESTONE). */
  subjectRef: string;
  /** Participant wallet — enforced against the plan. */
  raisedBy: string;
  reason: string;
  /** Bounded ref list — ≤50 × ≤1000 chars (contract guards 206). */
  evidenceRefs?: string[];
}

export interface ResolveDisputeInput {
  disputeId: string;
  operator: string;
  resolution: DisputeResolution;
  /** SPLIT only — the replacement legs; sum must equal the milestone
   *  amount. Existing non-completed legs are CANCELLED and replaced. */
  splitLegs?: PayoutLegInput[];
  /** Ops note — audit evidence only. */
  note?: string;
  /** EaaS verdict seam — recorded as evidence, never auto-resolves. */
  resolverRef?: string;
}

export interface MarkPaidInput {
  intentId: string;
  /** Required when the intent has more than one OPEN leg. */
  legId?: string;
  txHash: string;
  operator: string;
}

/** Injected verification seam — see verify-payout-tx.ts. */
export interface PayoutVerifyDeps {
  verifyTx?: import("./verify-payout-tx.js").VerifyPayoutTx;
  /** Fail-closed mode: no adapter → VERIFIER_UNAVAILABLE instead of
   *  the manual-ops attestation path (D-227-4 seam contract). */
  requireVerification?: boolean;
}
