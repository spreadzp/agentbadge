/**
 * SLICE-151-9: VenueStore (D12-151) — jobs + provider offers persistence.
 * JSON impl at .data/venue.json (pattern cloned from marketplace/catalog.ts).
 * DB adapter lands behind the same interface in EPIC-152 — no DATABASE_ENABLED
 * dependency. Attestations are NOT stored here — they share the 151-3
 * attestation-store (D11-151).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport";

// ─── Records ─────────────────────────────────────────────────────

export type VenueJobStatus =
  | "pending" // created in store, onchain tx not confirmed
  | "open" // created onchain, unfunded
  | "funded"
  | "submitted"
  | "completed"
  | "rejected"
  | "expired";

export interface VenueJob {
  /** Local record id (nanoid-ish). Onchain jobId stored separately. */
  jobId: string;
  /** ERC-8183 onchain jobId once createJob tx confirms. */
  onchainJobId?: number;
  title: string;
  description: string;
  budgetUsdc: number;
  status: VenueJobStatus;
  /** Client wallet (0x…) — the job poster. */
  client: string;
  /** Provider address (optional at creation — open board jobs). */
  provider?: string;
  /** Evaluator address — defaults to the venue oracle. */
  evaluator: string;
  category?: string;
  createdAt: string;
  chainTxs: {
    created?: string;
    funded?: string;
    submitted?: string;
    completed?: string;
  };
  /** Evaluator verdict once complete (pass/fail + reason). */
  verdict?: string;
}

export interface VenueOffer {
  providerAddress: string;
  /** ERC-8004 agentId the provider owns (provider-gate D5). */
  agentId: number;
  name: string;
  description: string;
  /** Service endpoint agents call after buying a pass. */
  endpoint: string;
  categories: string[];
  createdAt: string;
}

interface VenueData {
  jobs: Record<string, VenueJob>;
  offers: Record<string, VenueOffer>;
}

// ─── JSON persistence (catalog.ts clone) ─────────────────────────

const STORE_PATH = join(process.cwd(), ".data", "venue.json");
let _memStore: VenueData | null = null; // test override

function emptyStore(): VenueData {
  return { jobs: {}, offers: {} };
}

function loadStore(): VenueData {
  if (_memStore) return _memStore;
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, "utf8")) as VenueData;
    }
  } catch (err) {
    logger.warn("venue: store read failed, starting empty", {
      err: String(err),
    });
  }
  return emptyStore();
}

function saveStore(store: VenueData): void {
  if (_memStore) {
    _memStore = store;
    return;
  }
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    logger.error("venue: store write failed", { err: String(err) });
  }
}

// ─── Jobs ────────────────────────────────────────────────────────

export function upsertJob(job: VenueJob): void {
  const store = loadStore();
  store.jobs[job.jobId] = job;
  saveStore(store);
}

export function getJob(jobId: string): VenueJob | undefined {
  return loadStore().jobs[jobId];
}

export function listJobs(filter?: {
  status?: string;
  category?: string;
  limit?: number;
}): VenueJob[] {
  let all = Object.values(loadStore().jobs);
  if (filter?.status) {
    all = all.filter((j) => j.status === filter.status);
  }
  if (filter?.category) {
    const cat = filter.category.toLowerCase();
    all = all.filter((j) => j.category?.toLowerCase() === cat);
  }
  all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return filter?.limit ? all.slice(0, filter.limit) : all;
}

// ─── Offers ──────────────────────────────────────────────────────

export function upsertOffer(offer: VenueOffer): void {
  const store = loadStore();
  store.offers[offer.providerAddress.toLowerCase()] = offer;
  saveStore(store);
}

export function getOffer(providerAddress: string): VenueOffer | undefined {
  return loadStore().offers[providerAddress.toLowerCase()];
}

export function listOffers(filter?: { limit?: number }): VenueOffer[] {
  const all = Object.values(loadStore().offers).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return filter?.limit ? all.slice(0, filter.limit) : all;
}

// ─── Test hooks ──────────────────────────────────────────────────

export function useMemoryStoreForTesting() {
  _memStore = emptyStore();
}

export function resetStoreForTesting() {
  _memStore = null;
}
