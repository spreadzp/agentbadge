/**
 * SLICE-153-1: Venue tenancy model — venue registry.
 *
 * Business Venue = namespaced VenueStore slice (CONTEXT.md D1/D6): one
 * contract stack, venueId scopes jobs/offers; access control lives in
 * 153-2. The registry persists via the meta lane (getVenueMeta/setVenueMeta)
 * so BOTH backends (json + prisma) share identical semantics with zero
 * schema changes — meta survives deploys on prisma, ephemeral on json.
 *
 * Spec deviation: the slice doc says "json + sqlite impls" (written before
 * 152-9 landed the prisma backend) — parity is json ↔ prisma here.
 */
import { randomBytes } from "node:crypto";
import { isAddress } from "viem";
import { logger } from "@agentbadge/passport";

import { getVenueMeta, setVenueMeta } from "./store";

// ─── Entity ──────────────────────────────────────────────────────

export const PUBLIC_VENUE_ID = "public";
const REGISTRY_KEY = "venue:registry";

export interface VenueRecord {
  /** vn_<hex>; "public" is reserved for the platform venue. */
  id: string;
  /** url-safe, unique — /market/v/:slug. */
  slug: string;
  kind: "public" | "business";
  name: string;
  description?: string;
  ownerWallet: `0x${string}`;
  /** Admin-ops wallets acting on behalf of owner (D5-153). */
  delegates: `0x${string}`[];
  createdAt: number;
  active: boolean;
}

export interface VenueCreateInput {
  name: string;
  slug: string;
  kind: "public" | "business";
  ownerWallet: `0x${string}`;
  description?: string;
  delegates?: `0x${string}`[];
}

// ─── Registry persistence (meta lane) ────────────────────────────

function registry(): Record<string, VenueRecord> {
  return { ...(getVenueMeta<Record<string, VenueRecord>>(REGISTRY_KEY) ?? {}) };
}

function saveRegistry(map: Record<string, VenueRecord>): void {
  setVenueMeta(REGISTRY_KEY, map);
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const RESERVED = new Set([PUBLIC_VENUE_ID, "v", "new", "api"]);

// ─── Public API ──────────────────────────────────────────────────

/** Resolve by id OR slug. "public" always resolves to the platform venue. */
export function getVenue(idOrSlug: string): VenueRecord | undefined {
  if (idOrSlug === PUBLIC_VENUE_ID) {
    return {
      id: PUBLIC_VENUE_ID,
      slug: PUBLIC_VENUE_ID,
      kind: "public",
      name: "Public venue",
      ownerWallet: "0x0000000000000000000000000000000000000000",
      delegates: [],
      createdAt: 0,
      active: true,
    };
  }
  const map = registry();
  const byId = map[idOrSlug];
  if (byId) return byId;
  return Object.values(map).find((v) => v.slug === idOrSlug);
}

export function listVenues(filter?: {
  kind?: string;
  owner?: string;
}): VenueRecord[] {
  const all = Object.values(registry());
  return all.filter(
    (v) =>
      (!filter?.kind || v.kind === filter.kind) &&
      (!filter?.owner || v.ownerWallet.toLowerCase() === filter.owner.toLowerCase()),
  );
}

export function createVenue(input: VenueCreateInput): VenueRecord {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new Error(`invalid slug "${input.slug}" — [a-z0-9-], 3..64 chars`);
  }
  if (RESERVED.has(slug)) {
    throw new Error(`slug "${slug}" is reserved`);
  }
  if (!isAddress(input.ownerWallet)) {
    throw new Error("ownerWallet must be 0x…");
  }
  const map = registry();
  if (Object.values(map).some((v) => v.slug === slug)) {
    throw new Error(`slug "${slug}" already taken`);
  }
  const max = Number(process.env.ARC_VENUE_MAX_INSTANCES ?? 50);
  if (Object.keys(map).length >= max) {
    throw new Error(`venue limit reached (${max})`);
  }
  const venue: VenueRecord = {
    id: `vn_${randomBytes(8).toString("hex")}`,
    slug,
    kind: input.kind,
    name: input.name,
    description: input.description,
    ownerWallet: input.ownerWallet,
    delegates: input.delegates ?? [],
    createdAt: Date.now(),
    active: true,
  };
  map[venue.id] = venue;
  saveRegistry(map);
  logger.info("venue: instance created", {
    id: venue.id,
    slug,
    kind: input.kind,
    owner: input.ownerWallet,
  });
  return venue;
}

/** Patch mutable fields; id/slug/kind/ownerWallet are immutable. */
export function updateVenue(
  id: string,
  patch: Partial<
    Pick<VenueRecord, "name" | "description" | "delegates" | "active">
  >,
): VenueRecord | undefined {
  const map = registry();
  const cur = map[id];
  if (!cur) return undefined;
  const next: VenueRecord = { ...cur, ...patch, id: cur.id, slug: cur.slug, kind: cur.kind, ownerWallet: cur.ownerWallet };
  map[id] = next;
  saveRegistry(map);
  return next;
}

/** Effective venueId of a record — legacy rows default to "public". */
export function venueIdOf(rec: { venueId?: string }): string {
  return rec.venueId ?? PUBLIC_VENUE_ID;
}
