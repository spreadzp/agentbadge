/**
 * SLICE-199-05 (EPIC-199): shared board record types for the pluggable
 * BoardStore. These are the persistence-level records mirrored by the JSON
 * backend (`.data/board.json`) and the Postgres backend
 * ("boardCard"/"boardEntry"/"reputationWrite"/"chainTxOutbox", whole record
 * in `payload`, queryable columns kept in sync).
 *
 * Invariants (decisions.md):
 *  - D-199-4: `specHash` is immutable — `keccak256(spec)` is written at
 *    createCard and there is intentionally NO update path for spec,
 *    specHash, bountyId or title.
 *  - BoardEntry is an append-only journal, unique(cardId, seq): every
 *    attempt is preserved (attempt-indexed) and reads come back
 *    chronologically by seq.
 *  - BoardCard ↔ Bounty is 1:1 — `bountyId` is unique.
 *  - D-199-7: every ops-signer transaction goes through ChainTxOutbox with
 *    a unique `idempotencyKey`; a crash before send leaves a `pending` row.
 *  - ReputationWrite is the universal ERC-8004 feedback ledger —
 *    unique(sourceType, sourceId, jobAttempt) makes retries idempotent.
 */
import { randomBytes } from "node:crypto";
import { keccak256, stringToHex, type Hex } from "viem";

export type BoardColumn =
  | "todo"
  | "in_progress"
  | "testing"
  | "review"
  | "done"
  | "bug"
  | "cancelled";

export type BoardEntryKind =
  | "create"
  | "claim"
  | "submit"
  | "qa"
  | "review"
  | "bug"
  | "reopen"
  | "done"
  | "cancel"
  | "rating"
  | "note";

export type ChainTxKind =
  | "createJob"
  | "setProvider"
  | "fund"
  | "submit"
  | "complete"
  | "reject"
  | "claimRefund"
  | "giveFeedback";

export type OutboxStatus = "pending" | "sent" | "confirmed" | "failed";
export type ReputationStatus = "pending" | "sent" | "skipped" | "failed";

export interface BoardCardRecord {
  cardId: string;
  /** → Bounty.bountyId (1:1, unique). */
  bountyId: string;
  /** Denormalized column; journal in BoardEntry is the source of truth. */
  column: BoardColumn;
  title: string;
  budgetUsdc?: string;
  /** keccak256(spec) — immutable after create. */
  specHash: string;
  /** Task spec text — immutable after create. */
  spec: string;
  createdBy?: string;
  /** Passport of the active executor. */
  currentPassportId?: string;
  /** Bug-column fix-resubmit TTL (sweeper input, 199-09). */
  fixDeadlineMs?: number;
  /** Labels, escrow refs (onchainJobId, txes). */
  payload?: Record<string, unknown>;
  createdAt: string; // ISO
}

/** Mutable card fields — everything else is immutable by design. */
export interface BoardCardPatch {
  column?: BoardColumn;
  currentPassportId?: string;
  /** `null` clears the field (fix resubmitted / card reopened). */
  fixDeadlineMs?: number | null;
  payload?: Record<string, unknown>;
}

export interface BoardEntryRecord {
  id: string;
  cardId: string;
  /** Monotonic per card — unique(cardId, seq). */
  seq: number;
  /** Job attempt this event belongs to (attempt-indexed journal). */
  attempt: number;
  kind: BoardEntryKind;
  actor: string; // passportId | reviewer wallet | "ops" | "sweeper" | "qa"
  txHash?: string;
  payload?: Record<string, unknown>; // signatures, reasonCodes, score
  atMs: number;
}

export interface ReputationWriteRecord {
  id: string;
  sourceType: "board" | "venue";
  /** cardId | venue jobId. */
  sourceId: string;
  jobAttempt: number;
  passportId: string;
  /** ERC-8004 agent id; absent → onchain skip (ledger-only). */
  agentId?: string;
  score: number;
  status: ReputationStatus;
  feedbackUri?: string; // data:application/json proof package
  feedbackHash?: string;
  txHash?: string; // giveFeedback tx
  /** Retry counter. */
  attempts: number;
  payload?: Record<string, unknown>;
}

export interface ReputationPatch {
  status?: ReputationStatus;
  agentId?: string;
  txHash?: string;
  feedbackUri?: string;
  feedbackHash?: string;
  attempts?: number;
  payload?: Record<string, unknown>;
}

export interface ChainTxOutboxRecord {
  id: string;
  kind: ChainTxKind;
  cardId?: string; // null for venue giveFeedback
  jobAttempt?: number;
  /** "board:{cardId}:{attempt}:{kind}" — unique, retry-safe. */
  idempotencyKey: string;
  status: OutboxStatus;
  txHash?: string;
  attempts: number;
  lastError?: string;
  payload: Record<string, unknown>; // call args, gas, nonce
  createdAt: string; // ISO
}

export interface OutboxPatch {
  status?: OutboxStatus;
  txHash?: string;
  attempts?: number;
  lastError?: string;
  payload?: Record<string, unknown>;
}

/** JSON file shape (.data/board.json). */
export interface BoardData {
  cards: Record<string, BoardCardRecord>;
  entries: Record<string, BoardEntryRecord>;
  reputation: Record<string, ReputationWriteRecord>;
  outbox: Record<string, ChainTxOutboxRecord>;
  meta: Record<string, unknown>;
}

// ─── spec hash (D-199-4) ─────────────────────────────────────────

/** keccak256 over the spec text — matches the onchain job specHash. */
export function computeSpecHash(spec: string): Hex {
  return keccak256(stringToHex(spec));
}

/** Thrown when a card's specHash does not match keccak256(spec). */
export class SpecHashMismatchError extends Error {
  constructor(specHash: string, expected: Hex) {
    super(
      `board card specHash mismatch: got ${specHash}, expected ${expected} (keccak256(spec))`,
    );
    this.name = "SpecHashMismatchError";
  }
}

/** Guard used by createCard in every backend — throws SpecHashMismatchError. */
export function assertSpecHash(spec: string, specHash: string): void {
  const expected = computeSpecHash(spec);
  if (specHash.toLowerCase() !== expected.toLowerCase()) {
    throw new SpecHashMismatchError(specHash, expected);
  }
}

// ─── id helpers ─────────────────────────────────────────────────

export function newCardId(): string {
  return `board_${randomBytes(8).toString("hex")}`;
}

export function newEntryId(): string {
  return `bent_${randomBytes(8).toString("hex")}`;
}

export function newReputationId(): string {
  return `rep_${randomBytes(8).toString("hex")}`;
}

export function newOutboxId(): string {
  return `txo_${randomBytes(8).toString("hex")}`;
}

/** Canonical outbox key — retry of the same logical op hits the same row. */
export function boardIdempotencyKey(
  cardId: string,
  attempt: number,
  kind: ChainTxKind,
): string {
  return `board:${cardId}:${attempt}:${kind}`;
}

