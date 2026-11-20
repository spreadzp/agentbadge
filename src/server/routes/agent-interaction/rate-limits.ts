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
  now?: () => number;
}): TieredLimiter {
  const now = opts.now ?? (() => Date.now());
  const limits = opts.limits;
  const hits = new Map<string, number[]>();
  let lastSweep = now();

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
    if (arr.length >= limit) return false;
    arr.push(t);
    return true;
  };

  return {
    allow(tier, key) {
      if (!check(opts.globalKey, opts.globalMax)) return false;
      return check(key, limits[tier]);
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
    now: opts.now,
  });
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
