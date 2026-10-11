/**
 * SLICE-197-02: JSON BountyStore backend — .data/bounties.json
 * (pattern cloned from venue/json-store.ts). Selected when
 * ARC_BOUNTY_STORE=json (default) — zero-dep, no DATABASE_ENABLED.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport";

import type {
  BountyClaimRecord,
  BountyData,
  BountyOutcomeRecord,
  BountyRecord,
  BountyStoreBackend,
  BountyTransitionRecord,
} from "./store";
import { claimKey } from "./store";

const STORE_PATH = join(process.cwd(), ".data", "bounties.json");
let _memStore: BountyData | null = null; // test override

export function emptyBountyData(): BountyData {
  return { bounties: {}, claims: {}, transitions: {}, outcomes: {}, meta: {} };
}

function loadStore(): BountyData {
  if (_memStore) return _memStore;
  try {
    if (existsSync(STORE_PATH)) {
      const data = JSON.parse(readFileSync(STORE_PATH, "utf8")) as BountyData;
      data.claims ??= {};
      data.transitions ??= {};
      data.outcomes ??= {};
      data.meta ??= {};
      return data;
    }
  } catch (err) {
    logger.warn("bounties: store read failed, starting empty", {
      err: String(err),
    });
  }
  return emptyBountyData();
}

function saveStore(store: BountyData): void {
  if (_memStore) {
    _memStore = store;
    return;
  }
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
