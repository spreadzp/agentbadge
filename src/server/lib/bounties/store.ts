/**
 * SLICE-197-02: BountyStore — bounties + claims + transitions + outcomes
 * persistence. Pluggable backend: `ARC_BOUNTY_STORE=json` (default,
 * .data/bounties.json) | `prisma` (Postgres via @agentbadge/database
 * BountyRepository, mirror + write-behind in db-store.ts).
 *
 * Routes call the free functions below; switching backend needs zero
 * route changes. Sync surface is load-bearing (venue/store.ts precedent):
 * the prisma backend serves an in-memory mirror and persists async.
 */
import { logger } from "@agentbadge/passport";

import type { BountyStatus } from "./lifecycle";
import {
  createJsonBountyStore,
  resetStoreForTesting as resetJsonStore,
  useMemoryStoreForTesting as memJsonStore,
} from "./json-store";
import { createBountyDbStore } from "./db-store";

// ─── Records (types.ts — shared JSON/prisma shape) ──────────────

export type {
  BountyClaimRecord,
  BountyData,
  BountyOutcomeRecord,
  BountyRecord,
  BountyTransitionRecord,
  PassportOwnerRecord,
} from "./types";
export { claimKey } from "./types";
import type {
  BountyClaimRecord,
  BountyOutcomeRecord,
  BountyRecord,
  BountyTransitionRecord,
  PassportOwnerRecord,
} from "./types";

// ─── Backend interface ───────────────────────────────────────────

export interface BountyStoreBackend {
  name: "json" | "prisma";
  /** Resolves when the backend finished hydration (json = immediately). */
  ready(): Promise<void>;
  /** Test/shutdown hook — resolves when queued writes landed. */
  flush(): Promise<void>;

  upsertBounty(bounty: BountyRecord): void;
  getBounty(bountyId: string): BountyRecord | undefined;
  listBounties(filter?: {
    status?: BountyStatus;
    limit?: number;
  }): BountyRecord[];

  upsertClaim(claim: BountyClaimRecord): void;
  getClaim(bountyId: string, jobAttempt: number): BountyClaimRecord | undefined;
  listExpiredClaims(nowMs: number): BountyClaimRecord[];
  listClaimsByPassport(passportId: string): BountyClaimRecord[];

  appendTransition(t: BountyTransitionRecord): void;
  listTransitions(bountyId: string): BountyTransitionRecord[];

  putOutcome(outcome: BountyOutcomeRecord): void;
  getOutcome(
    bountyId: string,
    jobAttempt: number,
  ): BountyOutcomeRecord | undefined;
  listOutcomesByPassport(passportId: string): BountyOutcomeRecord[];

  /**
   * Upsert a passport owner — monotonic by blockNumber: a row with an
   * older block is ignored (indexer replay/out-of-order safety, 197-04).
   */
  upsertPassportOwner(rec: PassportOwnerRecord): void;
  getPassportOwner(passportId: string): PassportOwnerRecord | undefined;
  listPassportsByOwner(owner: string): PassportOwnerRecord[];
  /** Highest indexed owner block — resume hint for the indexer. */
  maxPassportOwnerBlock(): number;

  getMeta<T>(key: string): T | undefined;
  setMeta(key: string, value: unknown): void;
}

let _backend: BountyStoreBackend | null = null;

function resolveBackend(): BountyStoreBackend {
  if (_backend) return _backend;
  const mode = (process.env.ARC_BOUNTY_STORE ?? "json").toLowerCase();
  if (mode === "db" || mode === "prisma") {
    try {
      const db = createBountyDbStore();
      if (db) {
        _backend = db;
        logger.info("bounties: store backend = prisma", {});
        return _backend;
      }
      logger.warn(
        "bounties: ARC_BOUNTY_STORE=%s but DATABASE_ENABLED off — json fallback",
        { mode },
      );
    } catch (err) {
      logger.error("bounties: db backend init failed — json fallback", {
        err: String(err),
      });
    }
  }
  _backend = createJsonBountyStore();
  return _backend;
}

export function bountyStoreBackend(): BountyStoreBackend {
  return resolveBackend();
}

// ─── Bounties ────────────────────────────────────────────────────

export function upsertBounty(bounty: BountyRecord): void {
  resolveBackend().upsertBounty(bounty);
}

export function getBounty(bountyId: string): BountyRecord | undefined {
  return resolveBackend().getBounty(bountyId);
}

export function listBounties(filter?: {
  status?: BountyStatus;
  limit?: number;
}): BountyRecord[] {
  return resolveBackend().listBounties(filter);
}

// ─── Claims ──────────────────────────────────────────────────────

export function upsertClaim(claim: BountyClaimRecord): void {
  resolveBackend().upsertClaim(claim);
}

export function getClaim(
  bountyId: string,
  jobAttempt: number,
): BountyClaimRecord | undefined {
  return resolveBackend().getClaim(bountyId, jobAttempt);
}

export function listExpiredClaims(nowMs: number): BountyClaimRecord[] {
  return resolveBackend().listExpiredClaims(nowMs);
}

export function listClaimsByPassport(
  passportId: string,
): BountyClaimRecord[] {
  return resolveBackend().listClaimsByPassport(passportId);
}

// ─── Transitions (append-only audit, Q27) ────────────────────────

export function appendTransition(t: BountyTransitionRecord): void {
  resolveBackend().appendTransition(t);
}

export function listTransitions(
  bountyId: string,
): BountyTransitionRecord[] {
  return resolveBackend().listTransitions(bountyId);
}

// ─── Outcomes ────────────────────────────────────────────────────

export function putOutcome(outcome: BountyOutcomeRecord): void {
  resolveBackend().putOutcome(outcome);
}

export function getOutcome(
  bountyId: string,
  jobAttempt: number,
): BountyOutcomeRecord | undefined {
  return resolveBackend().getOutcome(bountyId, jobAttempt);
}

export function listOutcomesByPassport(
  passportId: string,
): BountyOutcomeRecord[] {
  return resolveBackend().listOutcomesByPassport(passportId);
}

// ─── Passport owners (indexer mirror, 197-04) ────────────────────

export function upsertPassportOwner(rec: PassportOwnerRecord): void {
  resolveBackend().upsertPassportOwner(rec);
}

export function getPassportOwner(
  passportId: string,
): PassportOwnerRecord | undefined {
  return resolveBackend().getPassportOwner(passportId);
}

export function listPassportsByOwner(
  owner: string,
): PassportOwnerRecord[] {
  return resolveBackend().listPassportsByOwner(owner);
}

export function maxPassportOwnerBlock(): number {
  return resolveBackend().maxPassportOwnerBlock();
}

// ─── Meta ────────────────────────────────────────────────────────

export function getBountyMeta<T = unknown>(key: string): T | undefined {
  return resolveBackend().getMeta<T>(key);
}

export function setBountyMeta(key: string, value: unknown): void {
  resolveBackend().setMeta(key, value);
}

/** Resolves when the active backend finished hydration. */
export function bountyStoreReady(): Promise<void> {
  return resolveBackend().ready();
}

/** Resolves when all queued writes landed (shutdown/tests). */
export function bountyStoreFlush(): Promise<void> {
  return resolveBackend().flush();
}

// ─── Test hooks ──────────────────────────────────────────────────

export function useMemoryBountyStoreForTesting() {
  memJsonStore();
  _backend = createJsonBountyStore();
}

export function resetBountyStoreForTesting() {
  resetJsonStore();
  _backend = null;
}

/** Swap the whole backend (tests inject a fake). */
export function setBountyBackendForTesting(
  backend: BountyStoreBackend | null,
) {
  _backend = backend;
}
