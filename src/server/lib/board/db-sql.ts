/**
 * SLICE-199-05 (EPIC-199): raw-SQL plan builders for PrismaBoardStore.
 * `db.raw.sql` is a tagged template — `${value}` binds as $N
 * (bounties/db-sql.ts + venue/db-store.ts precedent). Whole record lands
 * in `payload` (hydration = JSON.parse of `payload::text`); queryable
 * columns stay in sync.
 *
 * `param()` comes from @agentbadge/database — NOT @prisma/orm-postgres —
 * because resolveInterpolation checks `instanceof ParamRef` and a second
 * node_modules copy is a different class (dual-instance bug).
 *
 * Inserts use `ON CONFLICT ... DO NOTHING` as the DB-level backstop
 * (mirror checks are the primary guard); patchable rows use UPDATE plans
 * that always rewrite the full `payload`.
 */
import { param } from "@agentbadge/database";

import type { getDatabase } from "../database";
import type {
  BoardCardRecord,
  BoardEntryRecord,
  ChainTxOutboxRecord,
  ReputationWriteRecord,
} from "./types";

type Db = NonNullable<ReturnType<typeof getDatabase>["db"]>;
/** Built query plan — executed via `db.runtime().execute(plan)`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plan = any;

/** Nullable text param — keeps INSERTs one-liners. */
const txt = (v: string | null | undefined) =>
  param(v ?? null, { codecId: "pg/text@1" });

/** Nullable int8 param — epoch-ms columns (codec requires bigint). */
const i8 = (v: number | null | undefined) =>
  param(v == null ? null : BigInt(v), { codecId: "pg/int8@1" });

/** Nullable int4 param — jobAttempt column. */
const i4 = (v: number | null | undefined) =>
  param(v ?? null, { codecId: "pg/int4@1" });

/** Nullable numeric param — budgetUsdc column. */
const num = (v: string | null | undefined) =>
  param(v ?? null, { codecId: "pg/numeric@1" });

/** SELECT whole-record payloads for mirror hydration. */
export function hydrationPlans(db: Db): {
  cards: Plan;
  entries: Plan;
  reputation: Plan;
  outbox: Plan;
  meta: Plan;
} {
  return {
    cards: db.raw
      .sql`SELECT "payload"::text AS payload FROM "boardCard"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
    entries: db.raw
      .sql`SELECT "payload"::text AS payload FROM "boardEntry"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
    reputation: db.raw
      .sql`SELECT "payload"::text AS payload FROM "reputationWrite"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
    outbox: db.raw
      .sql`SELECT "payload"::text AS payload FROM "chainTxOutbox"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
    meta: db.raw
      .sql`SELECT "hash" AS hash, "payload"::text AS payload FROM "marketplaceMeta" WHERE "hash" LIKE 'board.%'`
      .returnsRow({ hash: "pg/text@1", payload: "pg/text@1" })
      .build(),
  };
}

/** Insert-only; unique(bountyId) + PK are the DB backstop for the 1:1 rule. */
export function insertCardPlan(db: Db, c: BoardCardRecord): Plan {
  return db.raw
    .sql`INSERT INTO "boardCard" ("cardId","bountyId","column","title","budgetUsdc","specHash","createdBy","currentPassportId","fixDeadlineMs","payload","createdAt","updatedAt")
    VALUES (${c.cardId}, ${c.bountyId}, ${c.column}, ${c.title},
      ${num(c.budgetUsdc)}, ${c.specHash}, ${txt(c.createdBy)},
      ${txt(c.currentPassportId)}, ${i8(c.fixDeadlineMs)},
      ${JSON.stringify(c)}::json, ${c.createdAt}::timestamptz, now())
    ON CONFLICT ("cardId") DO NOTHING`
    .affectedCount()
    .build();
}

/** Whitelisted mutable columns only — specHash/bountyId/title never update. */
export function updateCardPlan(db: Db, c: BoardCardRecord): Plan {
  return db.raw
    .sql`UPDATE "boardCard" SET
      "column" = ${c.column},
      "currentPassportId" = ${txt(c.currentPassportId)},
      "fixDeadlineMs" = ${i8(c.fixDeadlineMs)},
      "payload" = ${JSON.stringify(c)}::json,
      "updatedAt" = now()
    WHERE "cardId" = ${c.cardId}`
    .affectedCount()
    .build();
}

/** Append-only; unique(cardId, seq) is the DB backstop for journal races. */
export function insertEntryPlan(db: Db, e: BoardEntryRecord): Plan {
  return db.raw
    .sql`INSERT INTO "boardEntry" ("id","cardId","seq","attempt","kind","actor","txHash","payload","atMs","createdAt")
    VALUES (${e.id}, ${e.cardId}, ${e.seq}, ${e.attempt}, ${e.kind},
      ${e.actor}, ${txt(e.txHash)}, ${JSON.stringify(e)}::json, ${e.atMs},
      now())
    ON CONFLICT ("cardId","seq") DO NOTHING`
    .affectedCount()
    .build();
}

/** Idempotent via unique(sourceType, sourceId, jobAttempt). */
export function insertReputationPlan(
  db: Db,
  r: ReputationWriteRecord,
): Plan {
  return db.raw
    .sql`INSERT INTO "reputationWrite" ("id","sourceType","sourceId","jobAttempt","passportId","agentId","score","status","feedbackUri","feedbackHash","txHash","attempts","payload","createdAt","updatedAt")
    VALUES (${r.id}, ${r.sourceType}, ${r.sourceId}, ${r.jobAttempt},
      ${r.passportId}, ${txt(r.agentId)}, ${r.score}, ${r.status},
      ${txt(r.feedbackUri)}, ${txt(r.feedbackHash)}, ${txt(r.txHash)},
      ${r.attempts}, ${JSON.stringify(r)}::json, now(), now())
    ON CONFLICT ("sourceType","sourceId","jobAttempt") DO NOTHING`
    .affectedCount()
    .build();
}

/** Mutable reputation columns + full payload (status/tx/retry transitions). */
export function updateReputationPlan(
  db: Db,
  r: ReputationWriteRecord,
): Plan {
  return db.raw
    .sql`UPDATE "reputationWrite" SET
      "status" = ${r.status}, "agentId" = ${txt(r.agentId)},
      "feedbackUri" = ${txt(r.feedbackUri)},
      "feedbackHash" = ${txt(r.feedbackHash)}, "txHash" = ${txt(r.txHash)},
      "attempts" = ${r.attempts}, "payload" = ${JSON.stringify(r)}::json,
      "updatedAt" = now()
    WHERE "id" = ${r.id}`
    .affectedCount()
    .build();
}

/** Idempotent enqueue via unique(idempotencyKey). */
export function insertOutboxPlan(db: Db, o: ChainTxOutboxRecord): Plan {
  return db.raw
    .sql`INSERT INTO "chainTxOutbox" ("id","kind","cardId","jobAttempt","idempotencyKey","status","txHash","attempts","lastError","payload","createdAt","updatedAt")
    VALUES (${o.id}, ${o.kind}, ${txt(o.cardId)}, ${i4(o.jobAttempt)},
      ${o.idempotencyKey}, ${o.status}, ${txt(o.txHash)}, ${o.attempts},
      ${txt(o.lastError)}, ${JSON.stringify(o)}::json,
      ${o.createdAt}::timestamptz, now())
    ON CONFLICT ("idempotencyKey") DO NOTHING`
    .affectedCount()
    .build();
}

/** Status/tx/retry transitions + full payload. */
export function updateOutboxPlan(db: Db, o: ChainTxOutboxRecord): Plan {
  return db.raw
    .sql`UPDATE "chainTxOutbox" SET
      "status" = ${o.status}, "txHash" = ${txt(o.txHash)},
      "attempts" = ${o.attempts}, "lastError" = ${txt(o.lastError)},
      "payload" = ${JSON.stringify(o)}::json, "updatedAt" = now()
    WHERE "id" = ${o.id}`
    .affectedCount()
    .build();
}

/** Board meta rows share `marketplaceMeta` with a `board.` key prefix. */
export function upsertBoardMetaPlan(db: Db, key: string, value: unknown): Plan {
  return db.raw
    .sql`INSERT INTO "marketplaceMeta" ("hash","payload","createdAt")
    VALUES (${`board.${key}`}, ${JSON.stringify(value ?? null)}::json, now())
    ON CONFLICT ("hash") DO UPDATE SET "payload" = EXCLUDED."payload"`
    .affectedCount()
    .build();
}
