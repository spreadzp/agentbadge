/**
 * SLICE-199-05 (EPIC-199): shared pure record helpers used identically by
 * the JSON backend and the Postgres mirror backend — patch appliers
 * (whitelist only: immutable fields can never be smuggled through a
 * runtime-cast patch) and query helpers (journal ordering, filters,
 * idempotency lookups).
 */
import type {
  BoardCardPatch,
  BoardCardRecord,
  BoardColumn,
  BoardEntryRecord,
  ChainTxOutboxRecord,
  OutboxPatch,
  OutboxStatus,
  ReputationPatch,
  ReputationStatus,
  ReputationWriteRecord,
} from "./types";

// ─── patch appliers ──────────────────────────────────────────────

/**
 * Whitelisted mutable card fields only — spec/specHash/bountyId/title are
 * immutable (D-199-4); forged patch keys never reach the record.
 */
export function applyCardPatch(
  card: BoardCardRecord,
  patch: BoardCardPatch,
): BoardCardRecord {
  const next = { ...card };
  if (patch.column !== undefined) next.column = patch.column;
  if (patch.currentPassportId !== undefined) {
    next.currentPassportId = patch.currentPassportId;
  }
  if (patch.fixDeadlineMs !== undefined) {
    if (patch.fixDeadlineMs === null) {
      delete next.fixDeadlineMs;
    } else {
      next.fixDeadlineMs = patch.fixDeadlineMs;
    }
  }
  if (patch.payload !== undefined) {
    next.payload = { ...card.payload, ...patch.payload };
  }
  return next;
}

export function applyReputationPatch(
  rec: ReputationWriteRecord,
  patch: ReputationPatch,
): ReputationWriteRecord {
  const next = { ...rec };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.agentId !== undefined) next.agentId = patch.agentId;
  if (patch.txHash !== undefined) next.txHash = patch.txHash;
  if (patch.feedbackUri !== undefined) next.feedbackUri = patch.feedbackUri;
  if (patch.feedbackHash !== undefined) {
    next.feedbackHash = patch.feedbackHash;
  }
  if (patch.attempts !== undefined) next.attempts = patch.attempts;
  if (patch.payload !== undefined) {
    next.payload = { ...rec.payload, ...patch.payload };
  }
  return next;
}

export function applyOutboxPatch(
  rec: ChainTxOutboxRecord,
  patch: OutboxPatch,
): ChainTxOutboxRecord {
  const next = { ...rec };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.txHash !== undefined) next.txHash = patch.txHash;
  if (patch.attempts !== undefined) next.attempts = patch.attempts;
  if (patch.lastError !== undefined) next.lastError = patch.lastError;
  if (patch.payload !== undefined) {
    next.payload = { ...rec.payload, ...patch.payload };
  }
  return next;
}

// ─── journal + card queries ──────────────────────────────────────

/** Chronological journal of one card, sorted by seq. */
export function cardEntries(
  entries: Iterable<BoardEntryRecord>,
  cardId: string,
): BoardEntryRecord[] {
  return [...entries]
    .filter((e) => e.cardId === cardId)
    .sort((a, b) => a.seq - b.seq);
}

/** Board listing: column filter, executor filter, newest first, limit. */
export function filterCards(
  cards: Iterable<BoardCardRecord>,
  filter?: { column?: BoardColumn; passportId?: string; limit?: number },
): BoardCardRecord[] {
  let list = [...cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (filter?.column) list = list.filter((c) => c.column === filter.column);
  if (filter?.passportId) {
    list = list.filter((c) => c.currentPassportId === filter.passportId);
  }
  return filter?.limit ? list.slice(0, filter.limit) : list;
}

/** Bug-column sweeper input (199-09): bug cards past fixDeadlineMs. */
export function expiredFixCards(
  cards: Iterable<BoardCardRecord>,
  nowMs: number,
): BoardCardRecord[] {
  return [...cards].filter(
    (c) =>
      c.column === "bug" &&
      c.fixDeadlineMs !== undefined &&
      c.fixDeadlineMs < nowMs,
  );
}

export function findCardByBounty(
  cards: Iterable<BoardCardRecord>,
  bountyId: string,
): BoardCardRecord | undefined {
  for (const c of cards) if (c.bountyId === bountyId) return c;
  return undefined;
}

// ─── reputation + outbox queries ─────────────────────────────────

/** Unique(sourceType, sourceId, jobAttempt) lookup for the rep ledger. */
export function findReputation(
  rows: Iterable<ReputationWriteRecord>,
  sourceType: string,
  sourceId: string,
  jobAttempt: number,
): ReputationWriteRecord | undefined {
  for (const r of rows) {
    if (
      r.sourceType === sourceType &&
      r.sourceId === sourceId &&
      r.jobAttempt === jobAttempt
    ) {
      return r;
    }
  }
  return undefined;
}

export function filterReputation(
  rows: Iterable<ReputationWriteRecord>,
  filter?: { status?: ReputationStatus; passportId?: string },
): ReputationWriteRecord[] {
  let list = [...rows];
  if (filter?.status) list = list.filter((r) => r.status === filter.status);
  if (filter?.passportId) {
    list = list.filter((r) => r.passportId === filter.passportId);
  }
  return list;
}

export function findOutboxByKey(
  rows: Iterable<ChainTxOutboxRecord>,
  idempotencyKey: string,
): ChainTxOutboxRecord | undefined {
  for (const o of rows) if (o.idempotencyKey === idempotencyKey) return o;
  return undefined;
}

/** Worker input: pending rows older than `olderThanMs` (epoch ms), FIFO. */
export function pendingOutbox(
  rows: Iterable<ChainTxOutboxRecord>,
  olderThanMs: number,
): ChainTxOutboxRecord[] {
  return [...rows]
    .filter(
      (o) => o.status === "pending" && Date.parse(o.createdAt) < olderThanMs,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function filterOutbox(
  rows: Iterable<ChainTxOutboxRecord>,
  filter?: { status?: OutboxStatus; cardId?: string },
): ChainTxOutboxRecord[] {
  let list = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (filter?.status) list = list.filter((o) => o.status === filter.status);
  if (filter?.cardId) list = list.filter((o) => o.cardId === filter.cardId);
  return list;
}
