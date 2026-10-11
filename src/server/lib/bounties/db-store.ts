/**
 * SLICE-197-02: BountyStore prisma backend — mirror + write-behind.
 * Pattern cloned from venue/db-store.ts: `db.raw.sql` tagged templates
 * on `getDatabase().db` (the raw lane bypasses the published contract —
 * no BountyRepository dependency on @agentbadge/database dist).
 *
 * Tables (camelCase, owned by packages/database migrations
 * app/20261011T1642_add_bounty_models): "bounty", "bountyClaim",
 * "bountyTransition", "bountyOutcome". Whole record goes into `payload`
 * (hydration = JSON.parse); queryable columns kept in sync for
 * sweeper/index reads.
 *
 * Selected via ARC_BOUNTY_STORE=prisma|db. Requires DATABASE_ENABLED +
 * DATABASE_URL — createBountyDbStore() returns null when off and the
 * caller falls back to json. `meta` stays in-memory here (sweeper
 * watermark is derivable from claims/transitions).
 */
import { randomUUID } from "node:crypto";
import { param } from "@agentbadge/database";
import { logger } from "@agentbadge/passport";

import { DbWriteBehind } from "../db-mirror";
import { getDatabase } from "../database";
import type {
  BountyClaimRecord,
  BountyOutcomeRecord,
  BountyRecord,
  BountyStoreBackend,
  BountyTransitionRecord,
} from "./store";
import { claimKey } from "./store";

type Db = NonNullable<ReturnType<typeof getDatabase>["db"]>;

interface Mirror {
  bounties: Map<string, BountyRecord>;
  claims: Map<string, BountyClaimRecord>;
  transitions: Map<string, BountyTransitionRecord>;
  outcomes: Map<string, BountyOutcomeRecord>;
  meta: Map<string, unknown>;
}

/**
 * Build the prisma-backed store, or null when DATABASE is disabled.
 * Hydration kicks off in the background; reads serve the mirror.
 */
export function createBountyDbStore(): BountyStoreBackend | null {
  const db = getDatabase().db;
  if (!db) return null;
  return new PrismaBountyStore(db);
}

export class PrismaBountyStore implements BountyStoreBackend {
  readonly name = "prisma" as const;
  private readonly mirror: Mirror = {
    bounties: new Map(),
    claims: new Map(),
    transitions: new Map(),
    outcomes: new Map(),
    meta: new Map(),
  };
  private readonly wb: DbWriteBehind;

  constructor(private readonly db: Db) {
    this.wb = new DbWriteBehind("bounties", () => this.init());
  }

  ready(): Promise<void> {
    return this.wb.ready();
  }

  /** Test/shutdown hook — resolves when queued writes landed. */
  flush(): Promise<void> {
    return this.wb.flush();
  }

  /** Hydrate mirror from Postgres — payload carries the whole record. */
  private async init(): Promise<void> {
    const [bounties, claims, transitions, outcomes] = await Promise.all([
      this.db.runtime().query(
        this.db.raw
          .sql`SELECT "payload"::text AS payload FROM "bounty"`
          .returnsRow({ payload: "pg/text@1" })
          .build(),
      ),
      this.db.runtime().query(
        this.db.raw
          .sql`SELECT "payload"::text AS payload FROM "bountyClaim"`
          .returnsRow({ payload: "pg/text@1" })
          .build(),
      ),
      this.db.runtime().query(
        this.db.raw
          .sql`SELECT "payload"::text AS payload FROM "bountyTransition"`
          .returnsRow({ payload: "pg/text@1" })
          .build(),
      ),
      this.db.runtime().query(
        this.db.raw
          .sql`SELECT "payload"::text AS payload FROM "bountyOutcome"`
          .returnsRow({ payload: "pg/text@1" })
          .build(),
      ),
    ]);

    for (const row of bounties as { payload: string }[]) {
      const b = JSON.parse(row.payload) as BountyRecord;
      this.mirror.bounties.set(b.bountyId, b);
    }
    for (const row of claims as { payload: string }[]) {
      const c = JSON.parse(row.payload) as BountyClaimRecord;
      this.mirror.claims.set(claimKey(c.bountyId, c.jobAttempt), c);
    }
    for (const row of transitions as { payload: string }[]) {
      const t = JSON.parse(row.payload) as BountyTransitionRecord;
      this.mirror.transitions.set(t.id, t);
    }
    for (const row of outcomes as { payload: string }[]) {
      const o = JSON.parse(row.payload) as BountyOutcomeRecord;
      this.mirror.outcomes.set(claimKey(o.bountyId, o.jobAttempt), o);
    }
    logger.info("bounties: db-store hydrated", {
      bounties: this.mirror.bounties.size,
      claims: this.mirror.claims.size,
    });
  }

  private enqueue(op: () => Promise<unknown>): void {
    this.wb.enqueue(op);
  }

  // ─── bounties ──────────────────────────────────────────────────

  upsertBounty(bounty: BountyRecord): void {
    this.mirror.bounties.set(bounty.bountyId, bounty);
    const payload = JSON.stringify(bounty);
    const onchainJobId = param(bounty.onchainJobId ?? null, {
      codecId: "pg/text@1",
    });
    const createdBy = param(bounty.createdBy ?? null, {
      codecId: "pg/text@1",
    });
    const plan = this.db.raw
      .sql`INSERT INTO "bounty" ("bountyId","status","onchainJobId","jobAttempt","budgetUsdc","createdBy","payload","updatedAt")
        VALUES (${bounty.bountyId}, ${bounty.status}, ${onchainJobId},
          ${bounty.jobAttempt}, ${bounty.budgetUsdc}::numeric, ${createdBy},
          ${payload}::json, now())
        ON CONFLICT ("bountyId") DO UPDATE SET "status" = EXCLUDED."status",
          "onchainJobId" = EXCLUDED."onchainJobId",
          "jobAttempt" = EXCLUDED."jobAttempt",
          "budgetUsdc" = EXCLUDED."budgetUsdc",
          "createdBy" = EXCLUDED."createdBy",
          "payload" = EXCLUDED."payload", "updatedAt" = now()`
      .affectedCount()
      .build();
    this.enqueue(() => this.db.runtime().execute(plan));
  }

  getBounty(bountyId: string): BountyRecord | undefined {
    return this.mirror.bounties.get(bountyId);
  }

  listBounties(filter?: {
    status?: BountyRecord["status"];
    limit?: number;
  }): BountyRecord[] {
    let all = [...this.mirror.bounties.values()];
    if (filter?.status) all = all.filter((b) => b.status === filter.status);
    all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter?.limit ? all.slice(0, filter.limit) : all;
  }

  // ─── claims ────────────────────────────────────────────────────

  upsertClaim(claim: BountyClaimRecord): void {
    const key = claimKey(claim.bountyId, claim.jobAttempt);
    this.mirror.claims.set(key, claim);
    const payload = JSON.stringify(claim);
    const plan = this.db.raw
      .sql`INSERT INTO "bountyClaim" ("id","bountyId","jobAttempt","passportId","payoutWallet","state","claimedAtMs","leaseUntilMs","payload","updatedAt")
        VALUES (${claim.id}, ${claim.bountyId}, ${claim.jobAttempt},
          ${claim.passportId}, ${claim.payoutWallet}, ${claim.state},
          ${claim.claimedAtMs}, ${claim.leaseUntilMs}, ${payload}::json, now())
        ON CONFLICT ("bountyId","jobAttempt") DO UPDATE SET
          "state" = EXCLUDED."state", "payload" = EXCLUDED."payload",
          "updatedAt" = now()`
      .affectedCount()
      .build();
    this.enqueue(() => this.db.runtime().execute(plan));
  }

  getClaim(
    bountyId: string,
    jobAttempt: number,
  ): BountyClaimRecord | undefined {
    return this.mirror.claims.get(claimKey(bountyId, jobAttempt));
  }

  listExpiredClaims(nowMs: number): BountyClaimRecord[] {
    return [...this.mirror.claims.values()].filter(
      (c) => c.state === "open" && c.leaseUntilMs < nowMs,
    );
  }

  listClaimsByPassport(passportId: string): BountyClaimRecord[] {
    return [...this.mirror.claims.values()]
      .filter((c) => c.passportId === passportId)
      .sort((a, b) => b.claimedAtMs - a.claimedAtMs);
  }

  // ─── transitions (append-only) ─────────────────────────────────

  appendTransition(t: BountyTransitionRecord): void {
    this.mirror.transitions.set(t.id, t);
    const payload = JSON.stringify(t);
    const reason = param(t.reason ?? null, { codecId: "pg/text@1" });
    const plan = this.db.raw
      .sql`INSERT INTO "bountyTransition" ("id","bountyId","actor","from","to","reason","atMs","payload","updatedAt")
        VALUES (${randomUUID()}, ${t.bountyId}, ${t.actor}, ${t.from},
          ${t.to}, ${reason}, ${t.atMs}, ${payload}::json, now())
        ON CONFLICT ("id") DO NOTHING`
      .affectedCount()
      .build();
    this.enqueue(() => this.db.runtime().execute(plan));
  }

  listTransitions(bountyId: string): BountyTransitionRecord[] {
    return [...this.mirror.transitions.values()]
      .filter((t) => t.bountyId === bountyId)
      .sort((a, b) => a.atMs - b.atMs);
  }

  // ─── outcomes ──────────────────────────────────────────────────

  putOutcome(outcome: BountyOutcomeRecord): void {
    const key = claimKey(outcome.bountyId, outcome.jobAttempt);
    // One verdict per attempt — repeat put never overwrites (audit).
    if (this.mirror.outcomes.has(key)) {
      logger.warn("bounties: duplicate outcome put ignored", {
        bountyId: outcome.bountyId,
        jobAttempt: outcome.jobAttempt,
      });
      return;
    }
    this.mirror.outcomes.set(key, outcome);
    const payload = JSON.stringify(outcome);
    const passportId = param(outcome.passportId ?? null, {
      codecId: "pg/text@1",
    });
    const reasonCodes = param(
      outcome.reasonCodes ? JSON.stringify(outcome.reasonCodes) : null,
      { codecId: "pg/text@1" },
    );
    const verdictMemoTx = param(outcome.verdictMemoTx ?? null, {
      codecId: "pg/text@1",
    });
    const verdictRejectTx = param(outcome.verdictRejectTx ?? null, {
      codecId: "pg/text@1",
    });
    const commitSha = param(outcome.commitSha ?? null, {
      codecId: "pg/text@1",
    });
    const plan = this.db.raw
      .sql`INSERT INTO "bountyOutcome" ("id","bountyId","jobAttempt","passportId","verdict","reasonCodes","verdictMemoTx","verdictRejectTx","commitSha","payload","updatedAt")
        VALUES (${outcome.id}, ${outcome.bountyId}, ${outcome.jobAttempt},
          ${passportId}, ${outcome.verdict}, ${reasonCodes}::json,
          ${verdictMemoTx}, ${verdictRejectTx}, ${commitSha},
          ${payload}::json, now())
        ON CONFLICT ("bountyId","jobAttempt") DO NOTHING`
      .affectedCount()
      .build();
    this.enqueue(() => this.db.runtime().execute(plan));
  }

  getOutcome(
    bountyId: string,
    jobAttempt: number,
  ): BountyOutcomeRecord | undefined {
    return this.mirror.outcomes.get(claimKey(bountyId, jobAttempt));
  }

  listOutcomesByPassport(passportId: string): BountyOutcomeRecord[] {
    return [...this.mirror.outcomes.values()].filter(
      (o) => o.passportId === passportId,
    );
  }

  // ─── meta (in-memory — sweeper watermark is derivable) ─────────

  getMeta<T>(key: string): T | undefined {
    return this.mirror.meta.get(key) as T | undefined;
  }

  setMeta(key: string, value: unknown): void {
    this.mirror.meta.set(key, value);
  }
}
