/**
 * SLICE-197-02: BountyStore prisma backend — mirror + write-behind.
 * Pattern cloned from venue/db-store.ts: `db.raw.sql` tagged templates
 * on `getDatabase().db` (the raw lane bypasses the published contract —
 * no BountyRepository dependency on @agentbadge/database dist).
 * SLICE-197-04: + "passportOwner" mirror (indexer resume + /me/agents).
 *
 * Tables (camelCase, owned by packages/database migrations
 * app/20261011T1642_add_bounty_models): "bounty", "bountyClaim",
 * "bountyTransition", "bountyOutcome", "passportOwner". SQL builders
 * live in db-sql.ts (max-lines). `meta` stays in-memory (sweeper
 * watermark is derivable from claims/transitions/owners).
 *
 * Selected via ARC_BOUNTY_STORE=prisma|db. Requires DATABASE_ENABLED +
 * DATABASE_URL — createBountyDbStore() returns null when off and the
 * caller falls back to json.
 */
import { randomUUID } from "node:crypto";
import { logger } from "@agentbadge/passport";

import { DbWriteBehind } from "../db-mirror";
import { getDatabase } from "../database";
import {
  hydrationPlans,
  insertOutcomePlan,
  insertTransitionPlan,
  upsertBountyPlan,
  upsertClaimPlan,
  upsertOwnerPlan,
} from "./db-sql";
import type {
  BountyClaimRecord,
  BountyOutcomeRecord,
  BountyRecord,
  BountyStoreBackend,
  BountyTransitionRecord,
  PassportOwnerRecord,
} from "./store";
import { claimKey } from "./store";

type Db = NonNullable<ReturnType<typeof getDatabase>["db"]>;

interface Mirror {
  bounties: Map<string, BountyRecord>;
  claims: Map<string, BountyClaimRecord>;
  transitions: Map<string, BountyTransitionRecord>;
  outcomes: Map<string, BountyOutcomeRecord>;
  owners: Map<string, PassportOwnerRecord>;
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
    owners: new Map(),
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
    const plans = hydrationPlans(this.db);
    const [bounties, claims, transitions, outcomes, owners] =
      await Promise.all([
        this.db.runtime().query(plans.bounties),
        this.db.runtime().query(plans.claims),
        this.db.runtime().query(plans.transitions),
        this.db.runtime().query(plans.outcomes),
        this.db.runtime().query(plans.owners),
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
    for (const row of owners as { payload: string }[]) {
      const r = JSON.parse(row.payload) as PassportOwnerRecord;
      this.mirror.owners.set(r.passportId, r);
    }
    logger.info("bounties: db-store hydrated", {
      bounties: this.mirror.bounties.size,
      claims: this.mirror.claims.size,
      owners: this.mirror.owners.size,
    });
  }

  private enqueue(op: () => Promise<unknown>): void {
    this.wb.enqueue(op);
  }

  // ─── bounties ──────────────────────────────────────────────────

  upsertBounty(bounty: BountyRecord): void {
    this.mirror.bounties.set(bounty.bountyId, bounty);
    const plan = upsertBountyPlan(this.db, bounty);
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
    this.mirror.claims.set(claimKey(claim.bountyId, claim.jobAttempt), claim);
    const plan = upsertClaimPlan(this.db, claim);
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
    const plan = insertTransitionPlan(this.db, t, randomUUID());
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
    const plan = insertOutcomePlan(this.db, outcome);
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

  // ─── passport owners (197-04 indexer mirror) ───────────────────

  upsertPassportOwner(rec: PassportOwnerRecord): void {
    const prev = this.mirror.owners.get(rec.passportId);
    // Monotonic by (block,log) — replay/older log never regresses owner.
    if (
      prev &&
      (prev.blockNumber > rec.blockNumber ||
        (prev.blockNumber === rec.blockNumber &&
          (prev.logIndex ?? 0) >= (rec.logIndex ?? 0)))
    ) {
      return;
    }
    this.mirror.owners.set(rec.passportId, rec);
    const plan = upsertOwnerPlan(this.db, rec);
    this.enqueue(() => this.db.runtime().execute(plan));
  }

  getPassportOwner(passportId: string): PassportOwnerRecord | undefined {
    return this.mirror.owners.get(passportId);
  }

  listPassportsByOwner(owner: string): PassportOwnerRecord[] {
    const o = owner.toLowerCase();
    return [...this.mirror.owners.values()]
      .filter((r) => r.owner.toLowerCase() === o)
      .sort((a, b) => a.passportId.localeCompare(b.passportId));
  }

  maxPassportOwnerBlock(): number {
    return [...this.mirror.owners.values()].reduce(
      (m, r) => Math.max(m, r.blockNumber),
      0,
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
