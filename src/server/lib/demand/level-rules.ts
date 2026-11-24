import type { DemandClusterRecord, DemandLevel } from "./types";
import { DEMAND_LEVEL_RANK } from "./types";
import type { DemandStore } from "./store";
import { buildDemandEvent } from "./events";

/**
 * EPIC-231 (SLICE-231-2, D-231-3, O1 → fixed): deterministic level
 * promotion rules. Unique-actor floors only — count is deliberately
 * NOT a promotion input: an actor repeating themselves must never
 * inflate demand (§13.2), so the ladder climbs on DISTINCT
 * (actorResolution, actorRef) pairs.
 *
 * Thresholds (O1, calibrated for early-stage real volumes — a young
 * registry sees single-digit actor counts; honest floors stay low
 * enough to move and high enough that one actor can't reach them):
 *   ≥2  unique actors → NEED        (someone else wanted it too)
 *   ≥5  unique actors → INTENT      (a real crowd, not a fan)
 *   ≥10 unique actors → PURCHASE_INTENT
 *   VERIFIED_DEMAND — NEVER by rules. Payment/escrow fact, confirmed
 *   deal or operator action only (§16.1) — that path is the
 *   operator's applyClusterLevel / a future payment seam, not text.
 */
export const DEMAND_LEVEL_THRESHOLDS: ReadonlyArray<{
  level: DemandLevel;
  minUniqueActors: number;
}> = [
  { level: "PURCHASE_INTENT", minUniqueActors: 10 },
  { level: "INTENT", minUniqueActors: 5 },
  { level: "NEED", minUniqueActors: 2 },
];

/** Highest level the actor count supports — null under NEED floor. */
export function promotionFor(uniqueActors: number): DemandLevel | null {
  for (const t of DEMAND_LEVEL_THRESHOLDS) {
    if (uniqueActors >= t.minUniqueActors) return t.level;
  }
  return null;
}

export interface LevelRuleResult {
  promoted: boolean;
  /** Cluster after the rule run (promoted row or the input). */
  cluster: DemandClusterRecord;
  target: DemandLevel | null;
}

/**
 * Evaluate the rules against a freshly recounted cluster and CAS the
 * level up when the actor floor supports a higher rung. One retry on
 * status_mismatch (a concurrent ingest raced the CAS — re-read and
 * try once more); a second miss gives up honestly — the next signal
 * re-evaluates anyway. Never demotes, never mints VERIFIED_DEMAND.
 */
export async function applyLevelRules(
  store: DemandStore,
  cluster: DemandClusterRecord,
): Promise<LevelRuleResult> {
  let current = cluster;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const target = promotionFor(current.uniqueActors);
    if (
      target === null ||
      (DEMAND_LEVEL_RANK[current.level as DemandLevel] ?? 0) >=
        DEMAND_LEVEL_RANK[target]
    ) {
      return { promoted: false, cluster: current, target };
    }
    const res = await store.applyClusterLevel(
      current.id,
      { from: current.level, to: target },
      buildDemandEvent("demand.cluster.updated", "INTERNAL", {
        clusterId: current.id,
        reason: "level_rules",
        uniqueActors: current.uniqueActors,
        from: current.level,
        to: target,
      }),
    );
    if (res.transitioned) {
      return { promoted: true, cluster: res.record, target };
    }
    if (res.reason === "missing") {
      return { promoted: false, cluster: current, target };
    }
    // status_mismatch/illegal → re-read once and retry.
    const fresh = await store.getCluster(current.id);
    if (!fresh) return { promoted: false, cluster: current, target };
    current = fresh;
  }
  return { promoted: false, cluster: current, target: null };
}
