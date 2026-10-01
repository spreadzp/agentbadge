/**
 * SLICE-151-9: VenueStore (D12-151) — jobs + provider offers persistence.
 * JSON impl at .data/venue.json (pattern cloned from marketplace/catalog.ts).
 * DB adapter lands behind the same interface in EPIC-152 — no DATABASE_ENABLED
 * dependency. Attestations are NOT stored here — they share the 151-3
 * attestation-store (D11-151).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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
  /** ERC-8004 agent ids when mirrored — needed for reputation feedback (152-3). */
  providerAgentId?: number;
  clientAgentId?: number;
  /** bytes32 deliverable hash from submit (152-2). */
  deliverableHash?: string;
  /** Reputation feedback loop state (152-3). */
  feedback?: {
    status: "pending" | "sent" | "failed" | "skipped";
    txHash?: string;
    feedbackURI?: string;
    reason?: string;
  };
  category?: string;
  createdAt: string;
  chainTxs: {
    created?: string;
    claimed?: string;
    funded?: string;
    submitted?: string;
    completed?: string;
    rejected?: string;
    refunded?: string;
  };
  /** Evaluator verdict once complete (pass/fail + reason). */
  verdict?: string;
}

export interface VenueOffer {
  /** Unique offer id (vo_<hex>). Legacy records keyed by provider get one on load. */
  id: string;
  providerAddress: string;
  /** ERC-8004 agentId the provider owns (provider-gate D5). Optional when gate off. */
  agentId?: number;
  name: string;
  description: string;
  /** Service endpoint agents call after buying a pass (x402 instant path). */
  endpoint?: string;
  /** Price in USDC (decimal). Absent = quote via Post-job flow. */
  priceUsdc?: number;
  /** Whether a job can be created directly from this offer. */
  claimable: boolean;
  /** false = deactivated via admin (soft delete, kept for audit). */
  active: boolean;
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
// SLICE-152-1: offers keyed by unique id (multiple per provider),
// legacy provider-keyed records migrated on load.

/** Normalize a possibly-legacy offer record (no id/active/claimable). */
function normalizeOffer(o: VenueOffer): VenueOffer {
  return {
    ...o,
    id: o.id ?? `vo_${randomBytes(8).toString("hex")}`,
    claimable: o.claimable ?? true,
    active: o.active ?? true,
    categories: o.categories ?? [],
  };
}

export function upsertOffer(offer: VenueOffer): void {
  const store = loadStore();
  const normalized = normalizeOffer(offer);
  store.offers[normalized.id] = normalized;
  saveStore(store);
}

export function getOfferById(id: string): VenueOffer | undefined {
  return loadStore().offers[id];
}

/** Compat lookup: most recent offer by provider (active preferred). */
export function getOffer(providerAddress: string): VenueOffer | undefined {
  const byProvider = listOffers({ provider: providerAddress });
  return byProvider.find((o) => o.active) ?? byProvider[0];
}

export function listOffers(filter?: {
  provider?: string;
  active?: boolean;
  limit?: number;
}): VenueOffer[] {
  let all = Object.values(loadStore().offers).map(normalizeOffer);
  if (filter?.provider) {
    const p = filter.provider.toLowerCase();
    all = all.filter((o) => o.providerAddress.toLowerCase() === p);
  }
  if (filter?.active !== undefined) {
    all = all.filter((o) => o.active === filter.active);
  }
  all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return filter?.limit ? all.slice(0, filter.limit) : all;
}

/** Soft delete — record stays for audit trail. */
export function deactivateOffer(id: string): boolean {
  const store = loadStore();
  const offer = store.offers[id];
  if (!offer) return false;
  store.offers[id] = { ...normalizeOffer(offer), active: false };
  saveStore(store);
  return true;
}

/**
 * Dogfood seed — bstock service offer so the catalog is never empty
 * on a fresh deploy (same role as the jobs seed from 151-9).
 */
export function seedVenueOffers(): void {
  const id = "vo_bstock_dogfood";
  if (getOfferById(id)) return;
  upsertOffer({
    id,
    providerAddress:
      process.env.ARC_VENUE_SEED_PROVIDER ??
      "0xcdd23d104AA4C10DE65F4DD0571eDfeC0458699d",
    name: "bstock-delta-realtime",
    description:
      "Real-time Binance spot delta feed — agent-callable market data " +
      "(x402 instant-buy or escrow job).",
    priceUsdc: 5,
    endpoint: "https://agentbadge.xyz/mcp/bstock",
    categories: ["market-data", "x402"],
    claimable: true,
    active: true,
    createdAt: new Date().toISOString(),
  });
}

// ─── Test hooks ──────────────────────────────────────────────────

export function useMemoryStoreForTesting() {
  _memStore = emptyStore();
}

export function resetStoreForTesting() {
  _memStore = null;
}
