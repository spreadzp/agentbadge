/**
 * SLICE-199-05 (EPIC-199): pluggable BoardStore — the persistence seam for
 * the Arc Task Board. Two interchangeable backends behind one interface:
 *
 *  - `json`   → `.data/board.json` file store (dev default; EPHEMERAL on
 *               Fly.io — fine for dev/tests, not prod).
 *  - `prisma` → Postgres mirror + write-behind over the boardCard /
 *               boardEntry / reputationWrite / chainTxOutbox tables
 *               (durable tier, D-199-6).
 *
 * Backend selection: `ARC_BOARD_STORE=db|prisma` (default `json`), same
 * shape as `ARC_BOUNTY_STORE` (EPIC-197 precedent).
 *
 * Invariants every backend MUST honour (contract-tested):
 *  - createCard throws SpecHashMismatchError when specHash ≠ keccak256(spec)
 *    and returns undefined on a duplicate cardId or bountyId (1:1 card↔bounty).
 *  - There is NO spec/specHash/bountyId/title update path — patchCard only
 *    applies whitelisted mutable fields.
 *  - BoardEntry is insert-only: appendEntry returns undefined when
 *    (cardId, seq) is already taken; the caller retries with nextEntrySeq.
 *  - enqueueOutbox is idempotent on idempotencyKey (returns the existing row).
 *  - putReputation is idempotent on (sourceType, sourceId, jobAttempt).
 */
import type {
  BoardCardPatch,
  BoardCardRecord,
  BoardEntryRecord,
  BoardColumn,
  ChainTxOutboxRecord,
  OutboxPatch,
  OutboxStatus,
  ReputationPatch,
  ReputationStatus,
  ReputationWriteRecord,
} from "./types";
import { createJsonBoardStore } from "./json-store";
import { createBoardDbStore } from "./db-store";

export type {
  BoardCardPatch,
  BoardCardRecord,
  BoardColumn,
  BoardEntryKind,
  BoardEntryRecord,
  ChainTxKind,
  ChainTxOutboxRecord,
  OutboxPatch,
  OutboxStatus,
  ReputationPatch,
  ReputationStatus,
  ReputationWriteRecord,
} from "./types";

export interface BoardStoreBackend {
  name: "json" | "prisma";
  ready(): Promise<void>;
  flush(): Promise<void>;

  // ─── cards ──────────────────────────────────────────────────
  /**
   * Insert-only create. Throws SpecHashMismatchError on a forged/stale
   * specHash; returns undefined on duplicate cardId or bountyId.
   */
  createCard(card: BoardCardRecord): BoardCardRecord | undefined;
  getCard(cardId: string): BoardCardRecord | undefined;
  getCardByBounty(bountyId: string): BoardCardRecord | undefined;
  listCards(filter?: {
    column?: BoardColumn;
    passportId?: string;
    limit?: number;
  }): BoardCardRecord[];
  /**
   * Mutable-field patch (column / executor / fix deadline / payload merge).
   * spec/specHash/bountyId/title/budgetUsdc are NOT writable — they are
   * absent from BoardCardPatch and stripped at runtime.
   */
  patchCard(
    cardId: string,
    patch: BoardCardPatch,
  ): BoardCardRecord | undefined;
  /** Bug-column sweeper input (199-09): bug cards past fixDeadlineMs. */
  listExpiredFix(nowMs: number): BoardCardRecord[];

  // ─── journal (append-only) ─────────────────────────────────
  /** Next free seq for a card (1 on a fresh journal). */
  nextEntrySeq(cardId: string): number;
  /**
   * Insert-only append. Returns undefined when (cardId, seq) is taken —
   * the caller retries with `nextEntrySeq(cardId)`.
   */
  appendEntry(entry: BoardEntryRecord): BoardEntryRecord | undefined;
  /** Chronological journal (by seq) — all attempts preserved. */
  listEntries(cardId: string): BoardEntryRecord[];
  lastEntry(cardId: string): BoardEntryRecord | undefined;

  // ─── reputation ledger ──────────────────────────────────────
  /**
   * Idempotent write — unique(sourceType, sourceId, jobAttempt). A retry
   * returns the existing row instead of duplicating giveFeedback.
   */
  putReputation(rec: ReputationWriteRecord): ReputationWriteRecord;
  getReputation(
    sourceType: string,
    sourceId: string,
    jobAttempt: number,
  ): ReputationWriteRecord | undefined;
  patchReputation(
    id: string,
    patch: ReputationPatch,
  ): ReputationWriteRecord | undefined;
  listReputation(filter?: {
    status?: ReputationStatus;
    passportId?: string;
  }): ReputationWriteRecord[];

  // ─── chain tx outbox (D-199-7) ──────────────────────────────
  /**
   * Idempotent enqueue — unique(idempotencyKey). A replayed enqueue
   * returns the existing row; a crash before send leaves `pending`.
   */
  enqueueOutbox(rec: ChainTxOutboxRecord): ChainTxOutboxRecord;
  getOutboxByKey(idempotencyKey: string): ChainTxOutboxRecord | undefined;
  patchOutbox(
    id: string,
    patch: OutboxPatch,
  ): ChainTxOutboxRecord | undefined;
  /** Worker input: pending rows older than `olderThanMs` (epoch ms). */
  listPendingOutbox(olderThanMs: number): ChainTxOutboxRecord[];
  listOutbox(filter?: {
    status?: OutboxStatus;
    cardId?: string;
  }): ChainTxOutboxRecord[];

  // ─── meta (sweeper watermarks etc.) ─────────────────────────
  getMeta<T = unknown>(key: string): T | undefined;
  setMeta(key: string, value: unknown): void;
}

// ─── backend resolution ──────────────────────────────────────────

let _backend: BoardStoreBackend | null = null;

function resolveBackend(): BoardStoreBackend {
  if (_backend) return _backend;
  const mode = (process.env.ARC_BOARD_STORE ?? "json").toLowerCase();
  if (mode === "db" || mode === "prisma") {
    const db = createBoardDbStore();
    if (db) return (_backend = db);
  }
  return (_backend = createJsonBoardStore());
}

export function boardStore(): BoardStoreBackend {
  return resolveBackend();
}

// ─── test hooks ──────────────────────────────────────────────────

/** Swap the singleton backend (tests). */
export function setBoardBackendForTesting(b: BoardStoreBackend): void {
  _backend = b;
}

/** Drop the cached backend so the next call re-resolves env. */
export function resetBoardBackendForTesting(): void {
  _backend = null;
}
