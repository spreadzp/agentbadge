/**
 * SLICE-224-2 (EPIC-224): commerce domain types — statuses, DTOs, errors.
 *
 * Actor = EVM wallet address, lowercase (D-224-3). Wallets are the canonical
 * id; optional agentId fields are Passport enrichment links only.
 */

// ---------- statuses (spec §4.1 + slice transition tables) ----------

export const TASK_STATUSES = [
  "DRAFT",
  "OPEN",
  "IN_PROGRESS",
  "SUBMITTED",
  "UNDER_REVIEW",
  "COMPLETED",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OFFER_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const AGREEMENT_STATUSES = [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const SUBMISSION_STATUSES = [
  "SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "REVISION_REQUIRED",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_VERDICTS = [
  "ACCEPTED",
  "REJECTED",
  "REVISION_REQUIRED",
] as const;
export type SubmissionVerdict = (typeof SUBMISSION_VERDICTS)[number];

export const PAYMENT_STATUSES = [
  "NOT_PAID",
  "PAYMENT_RECORDED",
  "PAYMENT_VERIFIED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const EVIDENCE_TYPES = [
  "URL",
  "FILE",
  "HASH",
  "TRANSACTION",
  "API_RESPONSE",
  "ATTESTATION",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const PAYMENT_MODES = [
  "RECORD_ONLY",
  "EXTERNAL_PAYMENT",
  "AGENTBADGE_CHECKOUT",
] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export type CommerceEntityType =
  | "task"
  | "offer"
  | "agreement"
  | "submission"
  | "evidence"
  | "payment";

// ---------- typed domain error ----------

export type CommerceErrorCode =
  | "NOT_FOUND" // 404 — entity missing
  | "FORBIDDEN" // 403 — authz matrix violation
  | "INVALID_TRANSITION" // 409 — state machine / stale row
  | "GUARD_REJECTED" // 400 — contract guard (shape/limits)
  | "CONFLICT"; // 409 — uniqueness (task↔agreement, agreement↔payment)

import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

export class CommerceError extends Error {
  readonly code: CommerceErrorCode;
  readonly httpStatus: number;
  readonly detail?: unknown;

  constructor(
    code: CommerceErrorCode,
    message: string,
    httpStatus: number,
    detail?: unknown,
  ) {
    super(message);
    this.name = "CommerceError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail;
  }
}

export const notFound = (what: string, id: string) =>
  new CommerceError("NOT_FOUND", `${what} ${id} not found`, 404);

export const forbidden = (msg: string) =>
  new CommerceError("FORBIDDEN", msg, 403);

export const invalidTransition = (
  entity: string,
  from: string,
  to: string,
) =>
  new CommerceError(
    "INVALID_TRANSITION",
    `${entity}: ${from} → ${to} is not a legal transition`,
    409,
    { entity, from, to },
  );

export const guardRejected = (msg: string, detail?: unknown) =>
  new CommerceError("GUARD_REJECTED", msg, 400, detail);

export const conflict = (msg: string) =>
  new CommerceError("CONFLICT", msg, 409);

// ---------- write inputs (DTOs at the edge) ----------

export interface TaskCreateInput {
  title: string;
  description: string;
  requirements?: JsonValue | null;
  /** USD decimal string; absent = zero-budget task. */
  budget?: string | null;
  currency?: string;
  /** Informational only — no auto-expire (D-224-12). */
  expiresAtMs?: number | null;
  /** Default OPEN; DRAFT allowed for staged creation. */
  status?: "DRAFT" | "OPEN";
  buyerAgentId?: string | null;
  /** Parallel provider slots (D-227) — default 1, max 32. */
  maxProviders?: number | null;
  payload?: JsonValue;
}

export interface OfferSubmitInput {
  price: string;
  currency?: string;
  eta?: string | null;
  proposal: string;
  providerAgentId?: string | null;
  payload?: JsonValue;
}

export interface SubmissionCreateInput {
  /** ≤4000 chars (contract guard). */
  summary: string;
  resultUrl?: string | null;
  /** ≤50 refs × ≤1000 chars (contract guard). */
  evidenceRefs?: string[];
  /** Settlement milestoneId (business key) inside the agreement's
   *  plan — binds this work unit to a payable milestone (D-227). */
  milestoneRef?: string | null;
  payload?: JsonValue;
}

export interface EvidenceAttachInput {
  /** Primary anchor per spec — either this or agreementId required. */
  submissionId?: string;
  agreementId?: string;
  type: EvidenceType;
  url?: string | null;
  /** sha256 (FILE/HASH) or txHash (TRANSACTION). */
  hash?: string | null;
  content?: string | null;
  metadata?: JsonValue | null;
  payload?: JsonValue;
}

export interface PaymentRecordInput {
  /** Decimal string; defaults to agreement.agreedAmount. */
  amount?: string | null;
  paymentId?: string | null;
  note?: string | null;
}
