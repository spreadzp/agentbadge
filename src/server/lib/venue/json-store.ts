/**
 * SLICE-151-9/152-5: JSON VenueStore backend — .data/venue.json
 * (pattern cloned from marketplace/catalog.ts). Selected when
 * ARC_VENUE_STORE=json (default) — zero-dep, no DATABASE_ENABLED.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport";

import type {
  VenueData,
  VenueJob,
  VenueOffer,
  VenueStoreBackend,
} from "./store";

// ─── JSON persistence ────────────────────────────────────────────

const STORE_PATH = join(process.cwd(), ".data", "venue.json");
let _memStore: VenueData | null = null; // test override

export function emptyVenueData(): VenueData {
  return { jobs: {}, offers: {}, meta: {} };
}

function loadStore(): VenueData {
  if (_memStore) return _memStore;
  try {
    if (existsSync(STORE_PATH)) {
      const data = JSON.parse(readFileSync(STORE_PATH, "utf8")) as VenueData;
      // Legacy files have no meta block (152-5 indexer watermark lives there).
      data.meta ??= {};
      return data;
    }
  } catch (err) {
    logger.warn("venue: store read failed, starting empty", {
      err: String(err),
    });
  }
  return emptyVenueData();
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

// ─── Offers normalization (shared with db-store) ─────────────────

/** Normalize a possibly-legacy offer record (no id/active/claimable). */
export function normalizeOffer(o: VenueOffer): VenueOffer {
  return {
    ...o,
    id: o.id ?? `vo_${randomBytes(8).toString("hex")}`,
    claimable: o.claimable ?? true,
    active: o.active ?? true,
    categories: o.categories ?? [],
  };
}

// ─── Backend ─────────────────────────────────────────────────────

export function createJsonVenueStore(): VenueStoreBackend {
  return {
    name: "json",
    ready: () => Promise.resolve(),

    upsertJob(job: VenueJob): void {
      const store = loadStore();
      store.jobs[job.jobId] = job;
      saveStore(store);
    },

    getJob(jobId: string): VenueJob | undefined {
      return loadStore().jobs[jobId];
    },

    listJobs(filter?: {
      status?: string;
      category?: string;
      venueId?: string;
      limit?: number;
    }): VenueJob[] {
      let all = Object.values(loadStore().jobs);
      if (filter?.venueId) {
        const v = filter.venueId;
        all = all.filter((j) => (j.venueId ?? "public") === v);
      }
      if (filter?.status) {
        all = all.filter((j) => j.status === filter.status);
      }
      if (filter?.category) {
        const cat = filter.category.toLowerCase();
        all = all.filter((j) => j.category?.toLowerCase() === cat);
      }
      all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return filter?.limit ? all.slice(0, filter.limit) : all;
    },

    upsertOffer(offer: VenueOffer): void {
      const store = loadStore();
      const normalized = normalizeOffer(offer);
      store.offers[normalized.id] = normalized;
      saveStore(store);
    },

    getOfferById(id: string): VenueOffer | undefined {
      return loadStore().offers[id];
    },

    listOffers(filter?: {
      provider?: string;
      active?: boolean;
      venueId?: string;
      limit?: number;
    }): VenueOffer[] {
      let all = Object.values(loadStore().offers).map(normalizeOffer);
      if (filter?.venueId) {
        const v = filter.venueId;
        all = all.filter((o) => (o.venueId ?? "public") === v);
      }
      if (filter?.provider) {
        const p = filter.provider.toLowerCase();
        all = all.filter((o) => o.providerAddress.toLowerCase() === p);
      }
      if (filter?.active !== undefined) {
        all = all.filter((o) => o.active === filter.active);
      }
      all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return filter?.limit ? all.slice(0, filter.limit) : all;
    },

    deactivateOffer(id: string): boolean {
      const store = loadStore();
      const offer = store.offers[id];
      if (!offer) return false;
      store.offers[id] = { ...normalizeOffer(offer), active: false };
      saveStore(store);
      return true;
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
  _memStore = emptyVenueData();
}

export function resetStoreForTesting() {
  _memStore = null;
}
