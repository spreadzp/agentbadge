/**
 * EPIC-228 (SLICE-228-3, O-228-1 resolved): tiered rate limits for
 * the interaction intake.
 *
 * Tiers (decision 2026-11-20):
 *   ANON    → 3 rpm, keyed ip+route (contact.ts-class conservative)
 *   API_KEY → 30 rpm per key (agentId from agentKeyAuth)
 *   DID     → 60 rpm per verified did
 * + one global bucket (eaas createRateLimiter precedent: ~10x top
 * tier) so a rotation flood can't bypass per-key caps.
 *
 * Sliding-window map with periodic sweep + hard max-entries bound —
 * same bounded-memory contract as request-inbox createSubmitLanes.
 */

import type { Context } from "hono";

import { resolveClientIp } from "../../middleware/rate-limit";
import type { ResolvedActor } from "../../lib/agent-interaction/actor";

export const TIER_LIMITS = {
  ANON: 3,
  API_KEY: 30,
  DID: 60,
} as const;

const WINDOW_MS = 60_000;
const GLOBAL_MAX = TIER_LIMITS.DID * 10;
const MAX_ENTRIES = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

export interface TieredLimiter {
  /** false = over the tier/global budget → caller emits 429. */
  allow(tier: keyof typeof TIER_LIMITS, key: string): boolean;
  /** SLICE-259-19: seconds until the oldest hit in the last-rejected
   *  bucket slides out of the window — for Retry-After on 429s. */
  retryAfterSec(): number;
}

/**
 * Generalized factory (SLICE-229-5): the same sliding-window
 * limiter with caller-supplied tier limits + a named global bucket —
 * knowledge search reuses it instead of copying the window logic.
 */
export function createTieredLimiter(opts: {
  limits: Record<keyof typeof TIER_LIMITS, number>;
  globalKey: string;
  globalMax: number;
  /** Optional per-tier group buckets checked before the global one —
   *  an ANON rotation-flood then cannot starve authenticated tiers. */
  tierGroups?: Partial<Record<keyof typeof TIER_LIMITS, { key: string; max: number }>>;
  now?: () => number;
}): TieredLimiter {
  const now = opts.now ?? (() => Date.now());
  const limits = opts.limits;
  const hits = new Map<string, number[]>();
  let lastSweep = now();
  let lastRetrySec = Math.ceil(WINDOW_MS / 1000);

  const check = (key: string, limit: number): boolean => {
    const t = now();
    if (t - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = t;
      for (const [k, arr] of hits) {
        const live = arr.filter((x) => t - x < WINDOW_MS);
        if (live.length === 0) hits.delete(k);
        else hits.set(k, live);
      }
      if (hits.size > MAX_ENTRIES) {
        // Rotation-flood bound: drop oldest-touched keys first.
        const drop = hits.size - MAX_ENTRIES;
        let i = 0;
        for (const k of hits.keys()) {
          if (i++ >= drop) break;
          hits.delete(k);
        }
      }
    }
    const arr = (hits.get(key) ?? []).filter((x) => t - x < WINDOW_MS);
    hits.set(key, arr);
    if (arr.length >= limit) {
      // Oldest live hit leaves the window first — honest Retry-After.
      lastRetrySec = Math.max(1, Math.ceil((arr[0]! + WINDOW_MS - t) / 1000));
      return false;
    }
    arr.push(t);
    return true;
  };

  return {
    retryAfterSec() {
      return lastRetrySec;
    },
    allow(tier, key) {
      // Per-key first: a rejected request must not burn the shared
      // global window (arc-audit H1 — one IP could lock out every
      // tier). A caller rejected at the group/global stage consumes
      // its own per-key slot only.
      if (!check(key, limits[tier])) return false;
      const group = opts.tierGroups?.[tier];
      if (group && !check(group.key, group.max)) return false;
      return check(opts.globalKey, opts.globalMax);
    },
  };
}

export function createTieredInteractionLimiter(
  opts: { now?: () => number } = {},
): TieredLimiter {
  return createTieredLimiter({
    limits: TIER_LIMITS,
    globalKey: "g:interaction",
    globalMax: GLOBAL_MAX,
    tierGroups: {
      // ANON rotation-flood can fill the shared global bucket; cap the
      // anonymous lane separately so API_KEY/DID callers survive.
      ANON: { key: "g:interaction:anon", max: GLOBAL_MAX / 10 },
    },
    now: opts.now,
  });
}

/** Fixed-rate sliding-window limiter (one key space, one limit) —
 *  for cheap pre-auth throttles that run before identity is known. */
export function createFixedLimiter(
  max: number,
  opts: { windowMs?: number; now?: () => number } = {},
): { allow(key: string): boolean } {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const now = opts.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();
  return {
    allow(key) {
      const t = now();
      const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (arr.length >= max) {
        hits.set(key, arr);
        return false;
      }
      arr.push(t);
      hits.set(key, arr);
      return true;
    },
  };
}

/** Limiter bucket key for the caller — identity when known, else ip+route. */
export function limiterKey(c: Context, actor: ResolvedActor): string {
  switch (actor.resolution) {
    case "DID":
      return `did:${actor.actorRef}`;
    case "API_KEY":
      return `key:${actor.actorRef}`;
    default:
      return `ip:${resolveClientIp(c)}:${c.req.path}`;
  }
}
