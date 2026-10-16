/**
 * SLICE-199-05 (EPIC-199): BoardStore contract tests — the same suite runs
 * against the JSON backend (always, in-memory) and the Postgres backend
 * (live-gated on DATABASE_ENABLED + DATABASE_URL). Acceptance:
 *
 *  - specHash is immutable (D-199-4): createCard rejects a hash that does
 *    not match keccak256(spec); there is NO update path for spec — a
 *    runtime-forged patch cannot smuggle spec/specHash/bountyId changes.
 *  - BoardEntry is insert-only, attempt-indexed, read back chronologically
 *    by seq; a conflicting (cardId, seq) append is rejected and the caller
 *    retries with nextEntrySeq.
 *  - 1:1 card↔bounty: a second createCard on the same bountyId is rejected.
 *  - ChainTxOutbox idempotent enqueue via idempotencyKey (D-199-7): a crash
 *    before send leaves a `pending` row the worker can pick up.
 *  - ReputationWrite unique(sourceType, sourceId, jobAttempt): retry never
 *    duplicates the giveFeedback ledger entry.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "../src/server/lib/database";
import type {
  BoardCardRecord,
  BoardEntryRecord,
  BoardStoreBackend,
  ChainTxOutboxRecord,
  ReputationWriteRecord,
} from "../src/server/lib/board/store";
import {
  computeSpecHash,
  SpecHashMismatchError,
} from "../src/server/lib/board/types";
import {
  createJsonBoardStore,
  resetBoardStoreForTesting,
  useMemoryBoardStoreForTesting,
} from "../src/server/lib/board/json-store";
import { PrismaBoardStore } from "../src/server/lib/board/db-store";

const RUN = `t199s-${randomBytes(4).toString("hex")}`;

const SPEC_V1 = "## Fix flaky bounty e2e\nRun bunx vitest run until green.";

function mkCard(n = 0, column: BoardCardRecord["column"] = "todo"): BoardCardRecord {
  const spec = `${SPEC_V1} #${n}`;
  return {
    cardId: `${RUN}-card-${n}-${randomBytes(3).toString("hex")}`,
    bountyId: `${RUN}-bounty-${n}-${randomBytes(3).toString("hex")}`,
    column,
    title: `card ${n}`,
    budgetUsdc: "5.00",
    specHash: computeSpecHash(spec),
    spec,
    createdBy: "ops",
    createdAt: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  };
}

function mkEntry(
  cardId: string,
  seq: number,
  opts: Partial<BoardEntryRecord> = {},
): BoardEntryRecord {
  return {
    id: `bent_${randomBytes(6).toString("hex")}`,
    cardId,
    seq,
    attempt: 1,
    kind: "claim",
    actor: `${RUN}-agent`,
    atMs: 1_700_000_000_000 + seq * 1000,
    ...opts,
  };
}

function mkReputation(
  sourceId: string,
  jobAttempt = 1,
): ReputationWriteRecord {
  return {
    id: `rep_${randomBytes(6).toString("hex")}`,
    sourceType: "board",
    sourceId,
    jobAttempt,
    passportId: `${RUN}-ps`,
    agentId: "did:ethr:5042:0xabc",
    score: 4,
    status: "pending",
    attempts: 0,
  };
}

function mkOutbox(
  cardId: string,
  attempt = 1,
  kind: ChainTxOutboxRecord["kind"] = "createJob",
): ChainTxOutboxRecord {
  return {
    id: `txo_${randomBytes(6).toString("hex")}`,
    kind,
    cardId,
    jobAttempt: attempt,
    idempotencyKey: `board:${cardId}:${attempt}:${kind}`,
    status: "pending",
    attempts: 0,
    payload: { to: "0x0000000000000000000000000000000000000813" },
    createdAt: new Date(1_700_000_000_000).toISOString(),
  };
}

/** Shared contract — call per backend. */
function boardStoreContract(
  name: string,
  make: () => BoardStoreBackend | null,
  cleanup?: () => Promise<void>,
) {
  let store: BoardStoreBackend | null = null;

  beforeEach(async () => {
    store = make();
    await store?.ready();
  });

  afterEach(async () => {
    await store?.flush();
    await cleanup?.();
  });

  describe(`BoardStore contract [${name}]`, () => {
    it("createCard + getCard/getCardByBounty roundtrip; 1:1 card↔bounty", () => {
      if (!store) return;
      const card = mkCard(1);
      expect(store.createCard(card)?.cardId).toBe(card.cardId);
      expect(store.getCard(card.cardId)?.title).toBe("card 1");
      expect(store.getCardByBounty(card.bountyId)?.cardId).toBe(card.cardId);

      // Duplicate cardId rejected.
      expect(store.createCard(card)).toBeUndefined();
      // Second card on the same bountyId rejected (1:1).
      const twin = { ...mkCard(2), bountyId: card.bountyId };
      expect(store.createCard(twin)).toBeUndefined();
      expect(store.getCardByBounty(card.bountyId)?.cardId).toBe(card.cardId);

      // Column filter for the board listing.
      expect(
        store.listCards({ column: "todo" }).map((c) => c.cardId),
      ).toContain(card.cardId);
      expect(
        store.listCards({ column: "done" }).map((c) => c.cardId),
      ).not.toContain(card.cardId);
    });

    it("spec is immutable: bad specHash rejected, no update path", () => {
      if (!store) return;
      const spec = "spec body v1";
      const good = { ...mkCard(3), spec, specHash: computeSpecHash(spec) };
      expect(store.createCard(good)).toBeDefined();

      // specHash mismatch → error (forged or stale spec).
      const forged = {
        ...mkCard(4),
        spec: "spec body v2",
        specHash: computeSpecHash("spec body v1"),
      };
      expect(() => store!.createCard(forged)).toThrow(SpecHashMismatchError);

      // No update path for spec/specHash: a runtime-cast patch cannot touch
      // immutable fields — only column/passport/deadline/payload apply.
      const patch = {
        column: "review",
        specHash: computeSpecHash("tampered"),
        spec: "tampered",
        bountyId: "hijack",
        title: "tampered",
      } as unknown as Parameters<BoardStoreBackend["patchCard"]>[1];
      const patched = store.patchCard(good.cardId, patch);
      expect(patched?.column).toBe("review");
      expect(patched?.specHash).toBe(good.specHash);
      expect(patched?.spec).toBe(good.spec);
      expect(patched?.bountyId).toBe(good.bountyId);
      expect(patched?.title).toBe(good.title);
      expect(
        computeSpecHash(store.getCard(good.cardId)!.spec),
      ).toBe(store.getCard(good.cardId)!.specHash);
    });

    it("patchCard moves column, assigns executor, sets fix deadline", () => {
      if (!store) return;
      const card = mkCard(5);
      store.createCard(card);

      const moved = store.patchCard(card.cardId, {
        column: "bug",
        currentPassportId: `${RUN}-agent`,
        fixDeadlineMs: 1_700_000_500_000,
        payload: { labels: ["qa-fail"] },
      });
      expect(moved?.column).toBe("bug");
      expect(moved?.currentPassportId).toBe(`${RUN}-agent`);
      expect(moved?.fixDeadlineMs).toBe(1_700_000_500_000);
      expect(moved?.payload).toMatchObject({ labels: ["qa-fail"] });

      // Sweeper input: only bug-column cards past the deadline.
      expect(
        store.listExpiredFix(1_700_000_499_999).map((c) => c.cardId),
      ).not.toContain(card.cardId);
      expect(
        store.listExpiredFix(1_700_000_500_001).map((c) => c.cardId),
      ).toContain(card.cardId);
      // Unknown card → undefined.
      expect(store.patchCard(`${RUN}-none`, { column: "done" })).toBeUndefined();
    });

    it("journal is insert-only, attempt-indexed, chronological by seq", () => {
      if (!store) return;
      const card = mkCard(6);
      store.createCard(card);

      expect(store.nextEntrySeq(card.cardId)).toBe(1);
      const e1 = store.appendEntry(mkEntry(card.cardId, 1, { kind: "create" }));
      expect(e1?.seq).toBe(1);
      expect(store.nextEntrySeq(card.cardId)).toBe(2);

      // Simulated race: two appends compete for seq 2 → one loses.
      const a = mkEntry(card.cardId, 2, { kind: "claim", attempt: 1 });
      const b = mkEntry(card.cardId, 2, { kind: "claim", attempt: 2 });
      const first = store.appendEntry(a);
      const second = store.appendEntry(b);
      expect(first).toBeDefined();
      expect(second).toBeUndefined();

      // Retry with the next seq lands — both attempts stay in the journal.
      const retried = store.appendEntry({ ...b, seq: store.nextEntrySeq(card.cardId) });
      expect(retried?.seq).toBe(3);
      expect(store.nextEntrySeq(card.cardId)).toBe(4);

      // Chronological read preserves attempt 1 and 2 side by side.
      const journal = store.listEntries(card.cardId);
      expect(journal.map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(journal.map((e) => e.attempt)).toEqual([1, 1, 2]);
      expect(store.lastEntry(card.cardId)?.id).toBe(retried?.id);

      // Entries for another card never leak into this journal.
      const other = mkCard(7);
      store.createCard(other);
      store.appendEntry(mkEntry(other.cardId, 1));
      expect(store.listEntries(card.cardId)).toHaveLength(3);
    });

    it("outbox: idempotent enqueue, pending → sent → confirmed lifecycle", () => {
      if (!store) return;
      const card = mkCard(8);
      store.createCard(card);
      const tx = mkOutbox(card.cardId);
      expect(store.enqueueOutbox(tx)?.status).toBe("pending");

      // Crash between journal and send → row stays pending; re-enqueue with
      // the same idempotencyKey returns the SAME record (no duplicate).
      const dup = store.enqueueOutbox({ ...tx, id: `txo_${randomBytes(6).toString("hex")}` });
      expect(dup.id).toBe(tx.id);
      expect(store.listPendingOutbox(1_700_000_000_001).map((o) => o.id)).toContain(tx.id);

      // Worker picks it up: sent → confirmed (txHash recorded).
      const sent = store.patchOutbox(tx.id, { status: "sent", txHash: "0xtx1", attempts: 1 });
      expect(sent?.status).toBe("sent");
      const confirmed = store.patchOutbox(tx.id, { status: "confirmed" });
      expect(confirmed?.status).toBe("confirmed");
      expect(confirmed?.txHash).toBe("0xtx1");
      expect(store.listPendingOutbox(9_999_999_999_999)).toHaveLength(0);

      // Failed tx keeps the last error for the retry worker.
      const tx2 = mkOutbox(card.cardId, 1, "fund");
      store.enqueueOutbox(tx2);
      const failed = store.patchOutbox(tx2.id, {
        status: "failed",
        lastError: "nonce too low",
        attempts: 3,
      });
      expect(failed?.status).toBe("failed");
      expect(failed?.lastError).toBe("nonce too low");
      expect(failed?.attempts).toBe(3);
      expect(store.getOutboxByKey(tx2.idempotencyKey)?.status).toBe("failed");
      expect(store.patchOutbox(`${RUN}-none`, { status: "sent" })).toBeUndefined();
    });

    it("reputation ledger: unique attempt key, pending → sent/skip path", () => {
      if (!store) return;
      const card = mkCard(9);
      store.createCard(card);
      const rep = mkReputation(card.cardId);
      expect(store.putReputation(rep)?.status).toBe("pending");

      // Retry for the same attempt returns the existing row — no duplicate
      // giveFeedback write.
      const retry = store.putReputation({
        ...rep,
        id: `rep_${randomBytes(6).toString("hex")}`,
        status: "failed",
      });
      expect(retry.id).toBe(rep.id);
      expect(
        store.listReputation({ status: "failed" }).map((r) => r.id),
      ).not.toContain(rep.id);

      // Worker path: mark sent with the giveFeedback tx.
      const sent = store.patchReputation(rep.id, {
        status: "sent",
        txHash: "0xfb1",
        feedbackHash: "0xh",
        attempts: 1,
      });
      expect(sent?.status).toBe("sent");
      expect(sent?.txHash).toBe("0xfb1");
      expect(
        store.getReputation("board", card.cardId, 1)?.status,
      ).toBe("sent");
      expect(
        store.listReputation({ passportId: `${RUN}-ps` }).map((r) => r.id),
      ).toContain(rep.id);

      // agentId-less agent → skipped (ledger-only, no onchain write).
      const rep2 = { ...mkReputation(card.cardId, 2), agentId: undefined };
      store.putReputation(rep2);
      expect(
        store.patchReputation(rep2.id, { status: "skipped" })?.status,
      ).toBe("skipped");
    });

    it("meta roundtrip + ready/flush resolve", async () => {
      if (!store) return;
      store.setMeta(`${RUN}-key`, { watermark: 7 });
      expect(store.getMeta<{ watermark: number }>(`${RUN}-key`)).toEqual({
        watermark: 7,
      });
      await expect(store.flush()).resolves.toBeUndefined();
    });
  });
}

// ─── JSON backend (always) ───────────────────────────────────────

boardStoreContract(
  "json",
  () => {
    useMemoryBoardStoreForTesting();
    return createJsonBoardStore();
  },
  async () => resetBoardStoreForTesting(),
);

// ─── Postgres backend (live-gated) ───────────────────────────────

const db = getDatabase().db;

describe.skipIf(!db)("BoardStore Postgres backend (live)", () => {
  const cleanup = async () => {
    const statements = [
      db!.raw.sql`DELETE FROM "boardEntry" WHERE "cardId" LIKE ${`${RUN}%`}`,
      db!.raw.sql`DELETE FROM "boardCard" WHERE "cardId" LIKE ${`${RUN}%`}`,
      db!.raw.sql`DELETE FROM "reputationWrite" WHERE "sourceId" LIKE ${`${RUN}%`}`,
      db!.raw.sql`DELETE FROM "chainTxOutbox" WHERE "cardId" LIKE ${`${RUN}%`}`,
    ];
    for (const q of statements) {
      await db!.runtime().execute(q.affectedCount().build());
    }
  };

  boardStoreContract("prisma", () => new PrismaBoardStore(db!));
  afterEach(cleanup);

  it("restart: fresh store hydrates rows written by another instance", async () => {
    if (!db) return;
    const a = new PrismaBoardStore(db);
    await a.ready();
    const card = mkCard(10);
    a.createCard(card);
    a.appendEntry(mkEntry(card.cardId, 1));
    a.enqueueOutbox(mkOutbox(card.cardId));
    a.putReputation(mkReputation(card.cardId));
    await a.flush();

    const b = new PrismaBoardStore(db);
    await b.ready();
    expect(b.getCard(card.cardId)?.specHash).toBe(card.specHash);
    expect(b.listEntries(card.cardId)).toHaveLength(1);
    expect(b.getOutboxByKey(`board:${card.cardId}:1:createJob`)?.status).toBe("pending");
    expect(b.getReputation("board", card.cardId, 1)?.status).toBe("pending");
    await cleanup();
  });
});
