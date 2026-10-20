/**
 * SLICE-197-02: JSON BountyStore backend — .data/bounties.json
 * (pattern cloned from venue/json-store.ts). Selected when
 * ARC_BOUNTY_STORE=json (default) — zero-dep, no DATABASE_ENABLED.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport/logger";

import type {
  BountyClaimRecord,
  BountyData,
  BountyOutcomeRecord,
  BountyRecord,
  BountyStoreBackend,
  BountyTransitionRecord,
  PassportOwnerRecord,
} from "./store";
import { claimKey } from "./store";

const STORE_PATH = join(process.cwd(), ".data", "bounties.json");
let _memStore: BountyData | null = null; // test override
// 197-16 C-3: single in-memory primary copy — mutations apply to
// the shared object then persist, so concurrent requests can never
// overwrite each other's committed writes (read-modify-write on
// fresh file bytes was a lost-update window).
let _fileCache: BountyData | null = null;

export function emptyBountyData(): BountyData {
  return {
    bounties: {},
    claims: {},
    transitions: {},
    outcomes: {},
    owners: {},
    meta: {},
  };
}

function loadStore(): BountyData {
  if (_memStore) return _memStore;
  if (_fileCache) return _fileCache;
  try {
    if (existsSync(STORE_PATH)) {
      const data = JSON.parse(readFileSync(STORE_PATH, "utf8")) as BountyData;
      data.claims ??= {};
      data.transitions ??= {};
      data.outcomes ??= {};
      data.owners ??= {};
      data.meta ??= {};
      _fileCache = data;
      return data;
    }
  } catch (err) {
    logger.warn("bounties: store read failed, starting empty", {
      err: String(err),
    });
  }
  _fileCache = emptyBountyData();
  return _fileCache;
}

function saveStore(store: BountyData): void {
  if (_memStore) {
    _memStore = store;
    return;
  }
  _fileCache = store; // shared object — later readers see the write
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    logger.error("bounties: store write failed", { err: String(err) });
  }
}

export function newBountyId(): string {
  return `bty_${randomBytes(8).toString("hex")}`;
}

export function newTransitionId(): string {
  return `btr_${randomBytes(8).toString("hex")}`;
}

export function createJsonBountyStore(): BountyStoreBackend {
  return {
    name: "json",
    ready: () => Promise.resolve(),
    flush: () => Promise.resolve(),

    upsertBounty(bounty: BountyRecord): void {
      const store = loadStore();
      store.bounties[bounty.bountyId] = bounty;
      saveStore(store);
    },

    getBounty(bountyId: string): BountyRecord | undefined {
      return loadStore().bounties[bountyId];
    },

    listBounties(filter?: {
      status?: BountyRecord["status"];
      limit?: number;
    }): BountyRecord[] {
      let all = Object.values(loadStore().bounties);
      if (filter?.status) {
        all = all.filter((b) => b.status === filter.status);
      }
      all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return filter?.limit ? all.slice(0, filter.limit) : all;
    },

    upsertClaim(claim: BountyClaimRecord): void {
      const store = loadStore();
      store.claims[claimKey(claim.bountyId, claim.jobAttempt)] = claim;
      saveStore(store);
    },

    getClaim(
      bountyId: string,
      jobAttempt: number,
    ): BountyClaimRecord | undefined {
      return loadStore().claims[claimKey(bountyId, jobAttempt)];
    },

    listExpiredClaims(nowMs: number): BountyClaimRecord[] {
      return Object.values(loadStore().claims).filter(
        (c) => c.state === "open" && c.leaseUntilMs < nowMs,
      );
    },

    listClaimsByPassport(passportId: string): BountyClaimRecord[] {
      return Object.values(loadStore().claims)
        .filter((c) => c.passportId === passportId)
        .sort((a, b) => b.claimedAtMs - a.claimedAtMs);
    },

    appendTransition(t: BountyTransitionRecord): void {
      const store = loadStore();
      store.transitions[t.id] = t;
      saveStore(store);
    },

    listTransitions(bountyId: string): BountyTransitionRecord[] {
      return Object.values(loadStore().transitions)
        .filter((t) => t.bountyId === bountyId)
        .sort((a, b) => a.atMs - b.atMs);
    },

    putOutcome(outcome: BountyOutcomeRecord): void {
      const store = loadStore();
      const key = claimKey(outcome.bountyId, outcome.jobAttempt);
      // One verdict per attempt — a repeat put must not overwrite a
      // recorded verdict (audit integrity; db-store parity).
      if (store.outcomes[key]) {
        logger.warn("bounties: duplicate outcome put ignored", {
          bountyId: outcome.bountyId,
          jobAttempt: outcome.jobAttempt,
        });
        return;
      }
      store.outcomes[key] = outcome;
      saveStore(store);
    },

    patchOutcome(
      bountyId: string,
      jobAttempt: number,
      patch: Partial<BountyOutcomeRecord>,
    ): BountyOutcomeRecord | undefined {
      const store = loadStore();
      const key = claimKey(bountyId, jobAttempt);
      const prev = store.outcomes[key];
      if (!prev) return undefined;
      const next = { ...prev, ...patch, id: prev.id };
      store.outcomes[key] = next;
      saveStore(store);
      return next;
    },

    getOutcome(
      bountyId: string,
      jobAttempt: number,
    ): BountyOutcomeRecord | undefined {
      return loadStore().outcomes[claimKey(bountyId, jobAttempt)];
    },

    listOutcomesByPassport(passportId: string): BountyOutcomeRecord[] {
      return Object.values(loadStore().outcomes)
        .filter((o) => o.passportId === passportId)
        .sort((a, b) => b.bountyId.localeCompare(a.bountyId));
    },

    upsertPassportOwner(rec: PassportOwnerRecord): void {
      const store = loadStore();
      const prev = store.owners[rec.passportId];
      // Monotonic by block — replay/older log never regresses owner.
      if (
        prev &&
        (prev.blockNumber > rec.blockNumber ||
          (prev.blockNumber === rec.blockNumber &&
            (prev.logIndex ?? 0) >= (rec.logIndex ?? 0)))
      ) {
        return;
      }
      store.owners[rec.passportId] = rec;
      saveStore(store);
    },

    getPassportOwner(passportId: string): PassportOwnerRecord | undefined {
      return loadStore().owners[passportId];
    },

    listPassportsByOwner(owner: string): PassportOwnerRecord[] {
      const o = owner.toLowerCase();
      return Object.values(loadStore().owners)
        .filter((r) => r.owner.toLowerCase() === o)
        .sort((a, b) => a.passportId.localeCompare(b.passportId));
    },

    maxPassportOwnerBlock(): number {
      return Object.values(loadStore().owners).reduce(
        (m, r) => Math.max(m, r.blockNumber),
        0,
      );
    },

    getMeta<T>(key: string): T | undefined {
      return loadStore().meta?.[key] as T | undefined;
    },

    setMeta(key: string, value: unknown): void {
      const store = loadStore();
      store.meta ??= {};
      store.meta[key] = value;
      saveStore(store);
    },
  };
}

// ─── Test hooks (json backend only) ──────────────────────────────

export function useMemoryStoreForTesting() {
  _memStore = emptyBountyData();
}

export function resetStoreForTesting() {
  _memStore = null;
}
