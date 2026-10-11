/**
 * SLICE-197-02/04: raw-SQL plan builders for PrismaBountyStore.
 * `db.raw.sql` is a tagged template — `${value}` binds as $N
 * (venue/db-store.ts precedent). Whole record lands in `payload`
 * (hydration = JSON.parse); queryable columns stay in sync.
 */
import { param } from "@agentbadge/database";

import type { getDatabase } from "../database";
import type {
  BountyClaimRecord,
  BountyOutcomeRecord,
  BountyRecord,
  BountyTransitionRecord,
  PassportOwnerRecord,
} from "./types";

type Db = NonNullable<ReturnType<typeof getDatabase>["db"]>;
/** Built query plan — executed via `db.runtime().execute(plan)`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plan = any;

/** Nullable text param — keeps INSERTs one-liners. */
const txt = (v: string | null | undefined) =>
  param(v ?? null, { codecId: "pg/text@1" });

/** SELECT whole-record payloads for mirror hydration. */
export function hydrationPlans(db: Db): {
  bounties: Plan;
  claims: Plan;
  transitions: Plan;
  outcomes: Plan;
  owners: Plan;
} {
  return {
    bounties: db.raw
      .sql`SELECT "payload"::text AS payload FROM "bounty"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
    claims: db.raw
      .sql`SELECT "payload"::text AS payload FROM "bountyClaim"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
    transitions: db.raw
      .sql`SELECT "payload"::text AS payload FROM "bountyTransition"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
    outcomes: db.raw
      .sql`SELECT "payload"::text AS payload FROM "bountyOutcome"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
    owners: db.raw
      .sql`SELECT "payload"::text AS payload FROM "passportOwner"`
      .returnsRow({ payload: "pg/text@1" })
      .build(),
  };
}

export function upsertBountyPlan(db: Db, b: BountyRecord): Plan {
  const payload = JSON.stringify(b);
  return db.raw
    .sql`INSERT INTO "bounty" ("bountyId","status","onchainJobId","jobAttempt","budgetUsdc","createdBy","payload","updatedAt")
      VALUES (${b.bountyId}, ${b.status}, ${txt(b.onchainJobId)},
        ${b.jobAttempt}, ${b.budgetUsdc}::numeric, ${txt(b.createdBy)},
        ${payload}::json, now())
      ON CONFLICT ("bountyId") DO UPDATE SET "status" = EXCLUDED."status",
        "onchainJobId" = EXCLUDED."onchainJobId",
        "jobAttempt" = EXCLUDED."jobAttempt",
        "budgetUsdc" = EXCLUDED."budgetUsdc",
        "createdBy" = EXCLUDED."createdBy",
        "payload" = EXCLUDED."payload", "updatedAt" = now()`
    .affectedCount()
    .build();
}

export function upsertClaimPlan(db: Db, c: BountyClaimRecord): Plan {
  const payload = JSON.stringify(c);
  return db.raw
    .sql`INSERT INTO "bountyClaim" ("id","bountyId","jobAttempt","passportId","payoutWallet","state","claimedAtMs","leaseUntilMs","payload","updatedAt")
      VALUES (${c.id}, ${c.bountyId}, ${c.jobAttempt},
        ${c.passportId}, ${c.payoutWallet}, ${c.state},
        ${c.claimedAtMs}, ${c.leaseUntilMs}, ${payload}::json, now())
      ON CONFLICT ("bountyId","jobAttempt") DO UPDATE SET
        "state" = EXCLUDED."state", "payload" = EXCLUDED."payload",
        "updatedAt" = now()`
    .affectedCount()
    .build();
}

export function insertTransitionPlan(
  db: Db,
  t: BountyTransitionRecord,
  id: string,
): Plan {
  const payload = JSON.stringify(t);
  return db.raw
    .sql`INSERT INTO "bountyTransition" ("id","bountyId","actor","from","to","reason","atMs","payload","updatedAt")
      VALUES (${id}, ${t.bountyId}, ${t.actor}, ${t.from},
        ${t.to}, ${txt(t.reason)}, ${t.atMs}, ${payload}::json, now())
      ON CONFLICT ("id") DO NOTHING`
    .affectedCount()
    .build();
}

export function insertOutcomePlan(db: Db, o: BountyOutcomeRecord): Plan {
  const payload = JSON.stringify(o);
  const reasonCodes = param(
    o.reasonCodes ? JSON.stringify(o.reasonCodes) : null,
    { codecId: "pg/text@1" },
  );
  return db.raw
    .sql`INSERT INTO "bountyOutcome" ("id","bountyId","jobAttempt","passportId","verdict","reasonCodes","verdictMemoTx","verdictRejectTx","commitSha","payload","updatedAt")
      VALUES (${o.id}, ${o.bountyId}, ${o.jobAttempt},
        ${txt(o.passportId)}, ${o.verdict}, ${reasonCodes}::json,
        ${txt(o.verdictMemoTx)}, ${txt(o.verdictRejectTx)},
        ${txt(o.commitSha)}, ${payload}::json, now())
      ON CONFLICT ("bountyId","jobAttempt") DO NOTHING`
    .affectedCount()
    .build();
}

export function upsertOwnerPlan(db: Db, r: PassportOwnerRecord): Plan {
  const payload = JSON.stringify(r);
  return db.raw
    .sql`INSERT INTO "passportOwner" ("passportId","owner","blockNumber","logIndex","payload","updatedAt")
      VALUES (${r.passportId}, ${r.owner}, ${r.blockNumber},
        ${param(r.logIndex ?? null, { codecId: "pg/int4@1" })},
        ${payload}::json, now())
      ON CONFLICT ("passportId") DO UPDATE SET
        "owner" = EXCLUDED."owner", "blockNumber" = EXCLUDED."blockNumber",
        "logIndex" = EXCLUDED."logIndex", "payload" = EXCLUDED."payload",
        "updatedAt" = now()
      WHERE "passportOwner"."blockNumber" < EXCLUDED."blockNumber"
         OR ("passportOwner"."blockNumber" = EXCLUDED."blockNumber"
             AND COALESCE("passportOwner"."logIndex", -1)
                 < COALESCE(EXCLUDED."logIndex", -1))`
    .affectedCount()
    .build();
}
