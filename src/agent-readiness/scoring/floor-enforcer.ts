import type { Assertion } from "../rule-engine/assertion-builder";
import type { ScoringConfig, CategoryScore } from "./scoring-types";

export interface FloorCheckResult {
  triggered: boolean;
  capValue: number | null;
  triggeringRules: string[];
  triggeringCategories: string[];
  criticalTriggered: boolean;
  criticalCapValue: number | null;
  criticalTriggeringRules: string[];
}

export function checkFloor(
  assertions: Assertion[],
  config: ScoringConfig,
): FloorCheckResult {
  const triggeringRules: string[] = [];
  const triggeringCategories = new Set<string>();
  const criticalTriggeringRules: string[] = [];

  for (const assertion of assertions) {
    const severity = (assertion as any).severity as string | undefined;
    const category = (assertion as any).category as string | undefined;

    if (!severity || !config.floorTriggerSeverity.includes(severity as any)) continue;

    if (assertion.status === "GAP" || assertion.status === "CONFLICT") {
      // Critical severity triggers regardless of category
      if (severity === "critical") {
        criticalTriggeringRules.push(assertion.rule_id);
      } else if (category && config.floorCategories.includes(category as any)) {
        // High severity triggers only for floor categories
        triggeringRules.push(assertion.rule_id);
        triggeringCategories.add(category);
      }
    }
  }

  const highFloorTriggered = triggeringRules.length > 0;
  const criticalFloorTriggered = criticalTriggeringRules.length > 0;
  const triggered = highFloorTriggered || criticalFloorTriggered;

  const highCap = highFloorTriggered ? config.floorCap : null;
  const criticalCap = criticalFloorTriggered ? (config.criticalFloorCap ?? 30) : null;

  // When both floors fire, min applies
  const caps = [highCap, criticalCap].filter((c): c is number => c !== null);
  const capValue = caps.length > 0 ? Math.min(...caps) : null;

  return {
    triggered,
    capValue,
    triggeringRules: [...triggeringRules, ...criticalTriggeringRules],
    triggeringCategories: Array.from(triggeringCategories),
    criticalTriggered: criticalFloorTriggered,
    criticalCapValue: criticalCap,
    criticalTriggeringRules,
  };
}

export function applyFloorToCategories(
  categoryScores: CategoryScore[],
  floorCheck: FloorCheckResult,
): CategoryScore[] {
  if (!floorCheck.triggered) return categoryScores;
  return categoryScores.map((cs) => ({
    ...cs,
    floorTriggered: floorCheck.triggeringCategories.includes(cs.category),
  }));
}
