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

// ─── Records ─────────────────────────────────────────────────────

export interface BountyRecord {
  bountyId: string;
  title: string;
  /** Pre-claim structured brief (Q33): criteria, deliverable, steps, verify. */
  brief: {
    criteria: string[];
    deliverableType: "pr" | "url" | "post" | "report";
    steps?: string[];
    verify?: string;
  };
  description?: string;
  /** Decimal USDC string (matches Prisma Decimal codec). */
  budgetUsdc: string;
  status: BountyStatus;
  /** Active ERC-8183 onchain jobId; provider=0x0 until claim. */
  onchainJobId?: string;
  /** One job = one attempt (Q37/Q38-A); increments on reopen. */
  jobAttempt: number;
  /** Created by ops passport/wallet (Q4 client role). */
  createdBy?: string;
  /** Passport id of the agent that created the bounty (self-posted). */
  createdByPassportId?: string;
  /** Onchain tx hashes keyed by lifecycle step. */
  chainTxs?: Partial<
    Record<
      "created" | "funded" | "submitted" | "completed" | "rejected",
      string
    >
  >;
  /** Latest verdict memo anchor (197-10). */
  verdictMemoTx?: string;
  /** Extensible metadata (deliverable ref, tags…). */
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface BountyClaimRecord {
  /** Composite key `${bountyId}:${jobAttempt}` — one claim per attempt. */
  id: string;
  bountyId: string;
  jobAttempt: number;
  passportId: string;
  payoutWallet: string;
  /** open = active lease; expired = sweeper fired; consumed = submitted. */
  state: "open" | "expired" | "consumed";
  claimedAtMs: number;
  leaseUntilMs: number;
  payload?: Record<string, unknown>;
}

export interface BountyTransitionRecord {
  id: string;
  bountyId: string;
  actor: string;
  from: string;
  to: string;
  reason?: string;
  atMs: number;
  payload?: Record<string, unknown>;
}

export interface BountyOutcomeRecord {
  /** Composite key `${bountyId}:${jobAttempt}` — one verdict per attempt. */
  id: string;
  bountyId: string;
  jobAttempt: number;
  passportId?: string;
  verdict: "pass" | "fail" | "timeout";
  reasonCodes?: string[];
  verdictMemoTx?: string;
  verdictRejectTx?: string;
  commitSha?: string;
  payload?: Record<string, unknown>;
}

export interface BountyData {
  bounties: Record<string, BountyRecord>;
  claims: Record<string, BountyClaimRecord>;
  /** Append-only audit — keyed by transition id. */
  transitions: Record<string, BountyTransitionRecord>;
  outcomes: Record<string, BountyOutcomeRecord>;
  /** Sweeper watermark + misc state. */
  meta?: Record<string, unknown>;
}

export function claimKey(bountyId: string, jobAttempt: number): string {
  return `${bountyId}:${jobAttempt}`;
}

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
