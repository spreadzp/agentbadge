/**
 * SLICE-153-2: venue membership — per-venue whitelist with roles.
 *
 * Persisted via the store meta lane (key `venue:members:<id>`) so json +
 * prisma backends share identical semantics, same as the registry itself.
 * Reads are direct store hits — NO caching — so revoke is instant (AC3).
 *
 * Role ladder (D3-153): viewer < provider < admin < owner. The record's
 * ownerWallet is implicitly "owner"; its delegates[] count as "admin"
 * when no explicit member row exists.
 */
import { getAddress, isAddress } from "viem";
import { logger } from "@agentbadge/passport";

import { getVenueMeta, setVenueMeta } from "./store";
import { getVenue, type VenueRecord } from "./venues";

// ─── Types ───────────────────────────────────────────────────────

export type VenueMemberRole = "admin" | "provider" | "viewer";
export type VenueAccessRole = "owner" | VenueMemberRole;

export interface VenueMember {
  wallet: `0x${string}`;
  role: VenueAccessRole;
  addedBy: `0x${string}`;
  addedAt: number;
  revoked: boolean;
}

export interface VenueMemberInput {
  wallet: string;
  role: VenueMemberRole;
  addedBy: string;
}

const ROLE_RANK: Record<VenueAccessRole, number> = {
  viewer: 0,
  provider: 1,
  admin: 2,
  owner: 3,
};

const MEMBER_ROLES = new Set<VenueMemberRole>(["admin", "provider", "viewer"]);

// ─── Persistence (meta lane) ─────────────────────────────────────

const keyFor = (venueId: string) => `venue:members:${venueId}`;
const norm = (w: string) => w.toLowerCase();

function membersMap(venueId: string): Record<string, VenueMember> {
  return {
    ...(getVenueMeta<Record<string, VenueMember>>(keyFor(venueId)) ?? {}),
  };
}

function saveMembers(venueId: string, map: Record<string, VenueMember>): void {
  setVenueMeta(keyFor(venueId), map);
}

// ─── Public API ──────────────────────────────────────────────────

/** Add or re-invite a member (re-add clears the revoked flag). */
export function addVenueMember(
  venueId: string,
  input: VenueMemberInput,
): VenueMember {
  const venue = getVenue(venueId);
  if (!venue) throw new Error("venue not found");
  if (!isAddress(input.wallet)) throw new Error("wallet must be 0x…");
  if (!MEMBER_ROLES.has(input.role)) {
    throw new Error(`invalid role "${input.role}" — admin|provider|viewer`);
  }
  const wallet = getAddress(input.wallet);
  const map = membersMap(venueId);
  const member: VenueMember = {
    wallet,
    role: input.role,
    addedBy: isAddress(input.addedBy)
      ? getAddress(input.addedBy)
      : (input.addedBy as `0x${string}`),
    addedAt: Date.now(),
    revoked: false,
  };
  map[norm(wallet)] = member;
  saveMembers(venueId, map);
  logger.info("venue: member added", {
    venue: venueId,
    wallet,
    role: input.role,
  });
  return member;
}

/** Sticky revoke — a revoked row stays until explicitly re-added. */
export function revokeVenueMember(venueId: string, wallet: string): boolean {
  const map = membersMap(venueId);
  const m = map[norm(wallet)];
  if (!m) return false;
  m.revoked = true;
  saveMembers(venueId, map);
  logger.info("venue: member revoked", { venue: venueId, wallet });
  return true;
}

/**
 * Members list: stored rows + synthesized owner/delegates entries.
 * Revoked rows hidden unless includeRevoked.
 */
export function listVenueMembers(
  venueId: string,
  opts: { includeRevoked?: boolean } = {},
): VenueMember[] {
  const venue = getVenue(venueId);
  if (!venue) return [];
  const stored = Object.values(membersMap(venueId));
  const out = stored.filter((m) => opts.includeRevoked || !m.revoked);
  const seen = new Set(out.map((m) => norm(m.wallet)));
  const synth = (
    wallet: `0x${string}`,
    role: VenueAccessRole,
    addedAt: number,
  ): VenueMember => ({
    wallet,
    role,
    addedBy: wallet,
    addedAt,
    revoked: false,
  });
  if (!seen.has(norm(venue.ownerWallet))) {
    out.unshift(synth(venue.ownerWallet, "owner", venue.createdAt));
  }
  for (const d of venue.delegates) {
    if (!seen.has(norm(d)) && norm(d) !== norm(venue.ownerWallet)) {
      out.push(synth(d, "admin", venue.createdAt));
    }
  }
  return out;
}

/** Effective role of a wallet in a venue — undefined = not a member. */
export function venueRole(
  venue: VenueRecord,
  wallet: string,
): VenueAccessRole | undefined {
  const w = norm(wallet);
  if (norm(venue.ownerWallet) === w) return "owner";
  const m = membersMap(venue.id)[w];
  if (m) return m.revoked ? undefined : m.role;
  if (venue.delegates.some((d) => norm(d) === w)) return "admin";
  return undefined;
}

/** Role ≥ minRole? (viewer=0 < provider=1 < admin=2 < owner=3) */
export function venueHasRole(
  venue: VenueRecord,
  wallet: string,
  minRole: VenueAccessRole,
): boolean {
  const r = venueRole(venue, wallet);
  return r !== undefined && ROLE_RANK[r] >= ROLE_RANK[minRole];
}
