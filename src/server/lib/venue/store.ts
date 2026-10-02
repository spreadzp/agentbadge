/**
 * SLICE-151-9: VenueStore (D12-151) — jobs + provider offers persistence.
 * SLICE-152-5: pluggable backend — ARC_VENUE_STORE=json (default,
 * .data/venue.json) | prisma (Postgres via @agentbadge/database, mirror +
 * write-behind in db-store.ts). Routes call the free functions below;
 * switching backend needs zero route changes (D5-152 read path = our index).
 * Attestations are NOT stored here — they share the 151-3 attestation-store.
 */
import { logger } from "@agentbadge/passport";
import {
  createJsonVenueStore,
  normalizeOffer,
  useMemoryStoreForTesting as memJsonStore,
  resetStoreForTesting as resetJsonStore,
} from "./json-store";
import { createVenueDbStore } from "./db-store";

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
  /**
   * Take-rate mode (152-4): "hook" = onchain IACPHook on createJob,
   * "sweep" = post-settlement USDC transfer from server provider EOA,
   * "none" = external provider, no take rate.
   */
  feeMode?: "hook" | "sweep" | "none";
  /** Take-rate record after completion (sweep path). */
  fee?: {
    bps: number;
    /** Atomic USDC strings. */
    amountAtomic: string;
    providerAtomic: string;
    treasury: string;
    tx?: string;
    status: "pending" | "swept" | "skipped" | "failed";
    reason?: string;
  };
  /** Evaluator fee ledger (152-4): paid upfront before evaluate runs. */
  evalFee?: {
    required: boolean;
    paid: boolean;
    amountAtomic?: string;
    tx?: string;
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
  /** Tenancy namespace (153-1). Absent on legacy rows = "public". */
  venueId?: string;
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
  /** Tenancy namespace (153-1). Absent on legacy rows = "public". */
  venueId?: string;
}

export interface VenueData {
  jobs: Record<string, VenueJob>;
  offers: Record<string, VenueOffer>;
  /** Indexer watermark + misc state (152-5). */
  meta?: Record<string, unknown>;
}

// ─── Backend interface ───────────────────────────────────────────

/**
 * Synchronous store contract — the sync surface is load-bearing: all routes
 * read/write inline. The prisma backend keeps an in-memory mirror hydrated at
 * init and write-behind persists async (db-store.ts).
 */
export interface VenueStoreBackend {
  name: "json" | "prisma";
  /** Resolves when the backend finished hydration (json = immediately). */
  ready(): Promise<void>;
  upsertJob(job: VenueJob): void;
  getJob(jobId: string): VenueJob | undefined;
  listJobs(filter?: {
    status?: string;
    category?: string;
    venueId?: string;
    limit?: number;
  }): VenueJob[];
  upsertOffer(offer: VenueOffer): void;
  getOfferById(id: string): VenueOffer | undefined;
  listOffers(filter?: {
    provider?: string;
    active?: boolean;
    venueId?: string;
    limit?: number;
  }): VenueOffer[];
  deactivateOffer(id: string): boolean;
  getMeta<T>(key: string): T | undefined;
  setMeta(key: string, value: unknown): void;
}

let _backend: VenueStoreBackend | null = null;

function resolveBackend(): VenueStoreBackend {
  if (_backend) return _backend;
  const mode = (process.env.ARC_VENUE_STORE ?? "json").toLowerCase();
  if (mode === "db" || mode === "prisma" || mode === "sqlite") {
    try {
      const db = createVenueDbStore();
      if (db) {
        _backend = db;
        logger.info("venue: store backend = prisma", {});
        return _backend;
      }
      logger.warn("venue: ARC_VENUE_STORE=%s but DATABASE_ENABLED off — json fallback", {
        mode,
      });
    } catch (err) {
      logger.error("venue: db backend init failed — json fallback", {
        err: String(err),
      });
    }
  }
  _backend = createJsonVenueStore();
  return _backend;
}

export function venueStoreBackend(): VenueStoreBackend {
  return resolveBackend();
}

// ─── Jobs ────────────────────────────────────────────────────────

export function upsertJob(job: VenueJob): void {
  resolveBackend().upsertJob(job);
}

export function getJob(jobId: string): VenueJob | undefined {
  return resolveBackend().getJob(jobId);
}

export function listJobs(filter?: {
  status?: string;
  category?: string;
  venueId?: string;
  limit?: number;
}): VenueJob[] {
  return resolveBackend().listJobs(filter);
}

// ─── Offers ──────────────────────────────────────────────────────

export function upsertOffer(offer: VenueOffer): void {
  resolveBackend().upsertOffer(offer);
}

export function getOfferById(id: string): VenueOffer | undefined {
  return resolveBackend().getOfferById(id);
}

/** Compat lookup: most recent offer by provider (active preferred). */
export function getOffer(providerAddress: string): VenueOffer | undefined {
  const byProvider = listOffers({ provider: providerAddress });
  return byProvider.find((o) => o.active) ?? byProvider[0];
}

export function listOffers(filter?: {
  provider?: string;
  active?: boolean;
  venueId?: string;
  limit?: number;
}): VenueOffer[] {
  return resolveBackend().listOffers(filter);
}

/** Soft delete — record stays for audit trail. */
export function deactivateOffer(id: string): boolean {
  return resolveBackend().deactivateOffer(id);
}

// ─── Meta (indexer watermark, stats cache) ───────────────────────

export function getVenueMeta<T = unknown>(key: string): T | undefined {
  return resolveBackend().getMeta<T>(key);
}

export function setVenueMeta(key: string, value: unknown): void {
  resolveBackend().setMeta(key, value);
}

/** Resolves when the active backend finished hydration. */
export function venueStoreReady(): Promise<void> {
  return resolveBackend().ready();
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
  memJsonStore();
  _backend = createJsonVenueStore();
}

export function resetStoreForTesting() {
  resetJsonStore();
  _backend = null;
}

/** Swap the whole backend (tests inject a fake). */
export function setVenueBackendForTesting(backend: VenueStoreBackend | null) {
  _backend = backend;
}

export { normalizeOffer };
