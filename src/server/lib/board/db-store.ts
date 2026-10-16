/**
 * SLICE-199-05 (EPIC-199): Postgres backend for the BoardStore — an
 * in-memory mirror hydrated at construction; every mutation updates the
 * mirror synchronously and enqueues a serialized write-behind persist op
 * (DbWriteBehind, PrismaBountyStore precedent). Reads never touch the DB;
 * `ready()` resolves when hydration finished, `flush()` drains the queue.
 *
 * `createBoardDbStore()` returns null when the database is disabled —
 * `resolveBackend()` then falls back to the JSON store.
 */
import type { PrismaDb } from "@agentbadge/database";

import { getDatabase } from "../database";
import { DbWriteBehind } from "../db-mirror";
import {
  hydrationPlans,
  insertCardPlan,
  insertEntryPlan,
  insertOutboxPlan,
  insertReputationPlan,
  updateCardPlan,
  updateOutboxPlan,
  updateReputationPlan,
  upsertBoardMetaPlan,
} from "./db-sql";
import type { BoardStoreBackend } from "./store";
import { assertSpecHash } from "./types";
import type {
  BoardCardPatch,
  BoardCardRecord,
  BoardEntryRecord,
  ChainTxOutboxRecord,
  OutboxPatch,
  ReputationPatch,
  ReputationWriteRecord,
} from "./types";
import {
  applyCardPatch,
  applyOutboxPatch,
  applyReputationPatch,
  cardEntries,
  expiredFixCards,
  filterCards,
  filterOutbox,
  filterReputation,
  findCardByBounty,
  findOutboxByKey,
  findReputation,
  pendingOutbox,
} from "./helpers";

type Db = NonNullable<PrismaDb>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plan = any;

interface Mirror {
  cards: Map<string, BoardCardRecord>;
  entries: Map<string, BoardEntryRecord>;
  reputation: Map<string, ReputationWriteRecord>;
  outbox: Map<string, ChainTxOutboxRecord>;
  meta: Map<string, unknown>;
}

function parseRows<T>(rows: { payload: string }[]): T[] {
  return rows.map((r) => JSON.parse(r.payload) as T);
}

export class PrismaBoardStore implements BoardStoreBackend {
  readonly name = "prisma" as const;
  private readonly mirror: Mirror = {
    cards: new Map(),
    entries: new Map(),
    reputation: new Map(),
    outbox: new Map(),
    meta: new Map(),
  };
  private readonly wb: DbWriteBehind;

  constructor(private readonly db: Db) {
    this.wb = new DbWriteBehind("board", () => this.init());
  }

  private async init(): Promise<void> {
    const plans = hydrationPlans(this.db);
    const [cards, entries, reputation, outbox, meta] = await Promise.all([
      this.db.runtime().query(plans.cards),
      this.db.runtime().query(plans.entries),
      this.db.runtime().query(plans.reputation),
      this.db.runtime().query(plans.outbox),
      this.db.runtime().query(plans.meta),
    ]);
    for (const c of parseRows<BoardCardRecord>(cards)) {
      this.mirror.cards.set(c.cardId, c);
    }
    for (const e of parseRows<BoardEntryRecord>(entries)) {
      this.mirror.entries.set(e.id, e);
    }
    for (const r of parseRows<ReputationWriteRecord>(reputation)) {
      this.mirror.reputation.set(r.id, r);
    }
    for (const o of parseRows<ChainTxOutboxRecord>(outbox)) {
      this.mirror.outbox.set(o.id, o);
    }
    for (const row of meta as { hash: string; payload: string }[]) {
      this.mirror.meta.set(
        row.hash.replace(/^board\./, ""),
        JSON.parse(row.payload),
      );
    }
  }

  ready(): Promise<void> {
    return this.wb.ready();
  }

  flush(): Promise<void> {
    return this.wb.flush();
  }

  private exec(plan: Plan): void {
    this.wb.enqueue(() => this.db.runtime().execute(plan));
  }

  private entriesOf(cardId: string): BoardEntryRecord[] {
    return cardEntries(this.mirror.entries.values(), cardId);
  }

  // ─── cards ───────────────────────────────────────────────────

  createCard(card: BoardCardRecord): BoardCardRecord | undefined {
    assertSpecHash(card.spec, card.specHash);
    if (this.mirror.cards.has(card.cardId)) return undefined;
    if (findCardByBounty(this.mirror.cards.values(), card.bountyId)) {
      return undefined; // 1:1 card↔bounty
    }
    const stored = { ...card };
    this.mirror.cards.set(card.cardId, stored);
    this.exec(insertCardPlan(this.db, stored));
    return stored;
  }

  getCard(cardId: string): BoardCardRecord | undefined {
    return this.mirror.cards.get(cardId);
  }

  getCardByBounty(bountyId: string): BoardCardRecord | undefined {
    return findCardByBounty(this.mirror.cards.values(), bountyId);
  }

  listCards(filter?: {
    column?: BoardCardRecord["column"];
    passportId?: string;
    limit?: number;
  }): BoardCardRecord[] {
    return filterCards(this.mirror.cards.values(), filter);
  }

  patchCard(
    cardId: string,
    patch: BoardCardPatch,
  ): BoardCardRecord | undefined {
    const card = this.mirror.cards.get(cardId);
    if (!card) return undefined;
    const next = applyCardPatch(card, patch);
    this.mirror.cards.set(cardId, next);
    this.exec(updateCardPlan(this.db, next));
    return next;
  }

  listExpiredFix(nowMs: number): BoardCardRecord[] {
    return expiredFixCards(this.mirror.cards.values(), nowMs);
  }

  // ─── journal ─────────────────────────────────────────────────

  nextEntrySeq(cardId: string): number {
    const seqs = this.entriesOf(cardId).map((e) => e.seq);
    return seqs.length === 0 ? 1 : Math.max(...seqs) + 1;
  }

  appendEntry(entry: BoardEntryRecord): BoardEntryRecord | undefined {
    if (this.entriesOf(entry.cardId).some((e) => e.seq === entry.seq)) {
      return undefined; // unique(cardId, seq) — caller retries nextEntrySeq
    }
    const stored = { ...entry };
    this.mirror.entries.set(entry.id, stored);
    this.exec(insertEntryPlan(this.db, stored));
    return stored;
  }

  listEntries(cardId: string): BoardEntryRecord[] {
    return this.entriesOf(cardId);
  }

  lastEntry(cardId: string): BoardEntryRecord | undefined {
    return this.entriesOf(cardId).at(-1);
  }

  // ─── reputation ──────────────────────────────────────────────

  getReputation(
    sourceType: string,
    sourceId: string,
    jobAttempt: number,
  ): ReputationWriteRecord | undefined {
    return findReputation(
      this.mirror.reputation.values(),
      sourceType,
      sourceId,
      jobAttempt,
    );
  }

  putReputation(rec: ReputationWriteRecord): ReputationWriteRecord {
    const dup = this.getReputation(rec.sourceType, rec.sourceId, rec.jobAttempt);
    if (dup) return dup; // idempotent retry → existing row
    const stored = { ...rec };
    this.mirror.reputation.set(rec.id, stored);
    this.exec(insertReputationPlan(this.db, stored));
    return stored;
  }

  patchReputation(
    id: string,
    patch: ReputationPatch,
  ): ReputationWriteRecord | undefined {
    const rec = this.mirror.reputation.get(id);
    if (!rec) return undefined;
    const next = applyReputationPatch(rec, patch);
    this.mirror.reputation.set(id, next);
    this.exec(updateReputationPlan(this.db, next));
    return next;
  }

  listReputation(filter?: {
    status?: ReputationWriteRecord["status"];
    passportId?: string;
  }): ReputationWriteRecord[] {
    return filterReputation(this.mirror.reputation.values(), filter);
  }

  // ─── outbox ──────────────────────────────────────────────────

  getOutboxByKey(idempotencyKey: string): ChainTxOutboxRecord | undefined {
    return findOutboxByKey(this.mirror.outbox.values(), idempotencyKey);
  }

  enqueueOutbox(rec: ChainTxOutboxRecord): ChainTxOutboxRecord {
    const dup = this.getOutboxByKey(rec.idempotencyKey);
    if (dup) return dup; // idempotent retry → existing row
    const stored = { ...rec };
    this.mirror.outbox.set(rec.id, stored);
    this.exec(insertOutboxPlan(this.db, stored));
    return stored;
  }

  patchOutbox(
    id: string,
    patch: OutboxPatch,
  ): ChainTxOutboxRecord | undefined {
    const rec = this.mirror.outbox.get(id);
    if (!rec) return undefined;
    const next = applyOutboxPatch(rec, patch);
    this.mirror.outbox.set(id, next);
    this.exec(updateOutboxPlan(this.db, next));
    return next;
  }

  listPendingOutbox(olderThanMs: number): ChainTxOutboxRecord[] {
    return pendingOutbox(this.mirror.outbox.values(), olderThanMs);
  }

  listOutbox(filter?: {
    status?: ChainTxOutboxRecord["status"];
    cardId?: string;
  }): ChainTxOutboxRecord[] {
    return filterOutbox(this.mirror.outbox.values(), filter);
  }

  // ─── meta ────────────────────────────────────────────────────

  getMeta<T = unknown>(key: string): T | undefined {
    return this.mirror.meta.get(key) as T | undefined;
  }

  setMeta(key: string, value: unknown): void {
    this.mirror.meta.set(key, value);
    this.exec(upsertBoardMetaPlan(this.db, key, value));
  }
}

/**
 * Factory for the pluggable resolver — returns null when the database is
 * disabled so `resolveBackend()` falls back to the JSON store.
 */
export function createBoardDbStore(): PrismaBoardStore | null {
  const db = getDatabase().db;
  if (!db) return null;
  return new PrismaBoardStore(db);
}
