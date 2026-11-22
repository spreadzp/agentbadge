/**
 * EPIC-230 (SLICE-230-4): tiered rate limits for the feedback/review
 * surfaces — same tier vocabulary as interaction (O-228-1), separate
 * global buckets so a flood on one endpoint family can't starve the
 * other (or the interaction intake).
 */

import {
  createTieredLimiter,
  TIER_LIMITS,
  type TieredLimiter,
} from "../agent-interaction/rate-limits";

const GLOBAL_MAX = TIER_LIMITS.DID * 10;

export function createTieredFeedbackLimiter(
  opts: { now?: () => number } = {},
): TieredLimiter {
  return createTieredLimiter({
    limits: TIER_LIMITS,
    globalKey: "g:feedback",
    globalMax: GLOBAL_MAX,
    tierGroups: {
      ANON: { key: "g:feedback:anon", max: GLOBAL_MAX / 10 },
    },
    now: opts.now,
  });
}

export function createTieredReviewsLimiter(
  opts: { now?: () => number } = {},
): TieredLimiter {
  return createTieredLimiter({
    limits: TIER_LIMITS,
    globalKey: "g:reviews",
    globalMax: GLOBAL_MAX,
    tierGroups: {
      ANON: { key: "g:reviews:anon", max: GLOBAL_MAX / 10 },
    },
    now: opts.now,
  });
}
