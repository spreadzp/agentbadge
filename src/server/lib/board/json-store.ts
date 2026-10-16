/**
 * SLICE-199-05 (EPIC-199): JSON backend for the BoardStore — persists the
 * whole BoardData snapshot to `.data/board.json`. Single atomic file
 * (bounty `.data/bounties.json` precedent): card patches and journal
 * appends always land together, so a crash can't tear the pair.
 *
 * EPHEMERAL on Fly.io — the app volume is wiped on deploy. Prod uses the
 * `prisma` backend (ARC_BOARD_STORE=db) with DATABASE_ENABLED.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BoardStoreBackend } from "./store";
import { assertSpecHash, type BoardData } from "./types";
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

const DATA_DIR = join(process.cwd(), ".data");
const FILE = join(DATA_DIR, "board.json");

let _mem: BoardData | null = null;

function empty(): BoardData {
  return { cards: {}, entries: {}, reputation: {}, outbox: {}, meta: {} };
}

function loadStore(): BoardData {
  if (_mem) return _mem;
  try {
    const raw = readFileSync(FILE, "utf8");
    _mem = { ...empty(), ...(JSON.parse(raw) as Partial<BoardData>) };
  } catch {
    _mem = empty();
  }
  return _mem;
}

function saveStore(store: BoardData): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(store, null, 2));
}

/** Test hook: force the in-memory store (no file IO). */
export function useMemoryBoardStoreForTesting(data?: BoardData): void {
  _mem = data ?? empty();
}

/** Test hook: drop cached state. */
export function resetBoardStoreForTesting(): void {
  _mem = null;
}

export function createJsonBoardStore(): BoardStoreBackend {
  return {
    name: "json",
    ready: () => Promise.resolve(),
    flush: () => Promise.resolve(),

    // ─── cards ────────────────────────────────────────────────
    createCard(card) {
      assertSpecHash(card.spec, card.specHash);
      const s = loadStore();
      if (s.cards[card.cardId]) return undefined;
      if (findCardByBounty(Object.values(s.cards), card.bountyId)) {
        return undefined; // 1:1 card↔bounty
      }
      s.cards[card.cardId] = { ...card };
      saveStore(s);
      return s.cards[card.cardId];
    },
    getCard(cardId) {
      return loadStore().cards[cardId];
    },
    getCardByBounty(bountyId) {
      return findCardByBounty(Object.values(loadStore().cards), bountyId);
    },
    listCards(filter) {
      return filterCards(Object.values(loadStore().cards), filter);
    },
    patchCard(cardId, patch) {
      const s = loadStore();
      const card = s.cards[cardId];
      if (!card) return undefined;
      const next = applyCardPatch(card, patch);
      s.cards[cardId] = next;
      saveStore(s);
      return next;
    },
    listExpiredFix(nowMs) {
      return expiredFixCards(Object.values(loadStore().cards), nowMs);
    },

    // ─── journal ──────────────────────────────────────────────
    nextEntrySeq(cardId) {
      const seqs = cardEntries(
        Object.values(loadStore().entries),
        cardId,
      ).map((e) => e.seq);
      return seqs.length === 0 ? 1 : Math.max(...seqs) + 1;
    },
    appendEntry(entry) {
      const s = loadStore();
      if (
        cardEntries(Object.values(s.entries), entry.cardId).some(
          (e) => e.seq === entry.seq,
        )
      ) {
        return undefined; // unique(cardId, seq) — caller retries nextEntrySeq
      }
      s.entries[entry.id] = { ...entry };
      saveStore(s);
      return s.entries[entry.id];
    },
    listEntries(cardId) {
      return cardEntries(Object.values(loadStore().entries), cardId);
    },
    lastEntry(cardId) {
      return cardEntries(Object.values(loadStore().entries), cardId).at(-1);
    },

    // ─── reputation ───────────────────────────────────────────
    putReputation(rec) {
      const s = loadStore();
      const dup = findReputation(
        Object.values(s.reputation),
        rec.sourceType,
        rec.sourceId,
        rec.jobAttempt,
      );
      if (dup) return dup; // idempotent retry → existing row
      s.reputation[rec.id] = { ...rec };
      saveStore(s);
      return s.reputation[rec.id];
    },
    getReputation(sourceType, sourceId, jobAttempt) {
      return findReputation(
        Object.values(loadStore().reputation),
        sourceType,
        sourceId,
        jobAttempt,
      );
    },
    patchReputation(id, patch) {
      const s = loadStore();
      const rec = s.reputation[id];
      if (!rec) return undefined;
      const next = applyReputationPatch(rec, patch);
      s.reputation[id] = next;
      saveStore(s);
      return next;
    },
    listReputation(filter) {
      return filterReputation(Object.values(loadStore().reputation), filter);
    },

    // ─── outbox ───────────────────────────────────────────────
    enqueueOutbox(rec) {
      const s = loadStore();
      const dup = findOutboxByKey(
        Object.values(s.outbox),
        rec.idempotencyKey,
      );
      if (dup) return dup; // idempotent retry → existing row
      s.outbox[rec.id] = { ...rec };
      saveStore(s);
      return s.outbox[rec.id];
    },
    getOutboxByKey(idempotencyKey) {
      return findOutboxByKey(Object.values(loadStore().outbox), idempotencyKey);
    },
    patchOutbox(id, patch) {
      const s = loadStore();
      const rec = s.outbox[id];
      if (!rec) return undefined;
      const next = applyOutboxPatch(rec, patch);
      s.outbox[id] = next;
      saveStore(s);
      return next;
    },
    listPendingOutbox(olderThanMs) {
      return pendingOutbox(Object.values(loadStore().outbox), olderThanMs);
    },
    listOutbox(filter) {
      return filterOutbox(Object.values(loadStore().outbox), filter);
    },

    // ─── meta ─────────────────────────────────────────────────
    getMeta(key) {
      return loadStore().meta[key] as never;
    },
    setMeta(key, value) {
      const s = loadStore();
      s.meta[key] = value;
      saveStore(s);
    },
  };
}
