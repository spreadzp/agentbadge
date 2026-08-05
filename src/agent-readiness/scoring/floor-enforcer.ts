import type { Assertion } from "../rule-engine/assertion-builder";
import type { ScoringConfig, CategoryScore } from "./scoring-types";

export interface FloorCheckResult {
  triggered: boolean;
  capValue: number | null;
  triggeringRules: string[];
  triggeringCategories: string[];
}

export function checkFloor(
  assertions: Assertion[],
  config: ScoringConfig,
): FloorCheckResult {
  const triggeringRules: string[] = [];
  const triggeringCategories = new Set<string>();

  for (const assertion of assertions) {
    // Check if assertion's rule severity matches floor trigger severity
    // Assertion doesn't carry severity directly — orchestrator must pass rules
    // For now, we check via assertion metadata if available
    const severity = (assertion as any).severity as string | undefined;
    const category = (assertion as any).category as string | undefined;

    if (!severity || !config.floorTriggerSeverity.includes(severity as any)) continue;
    if (!category || !config.floorCategories.includes(category as any)) continue;

    if (assertion.status === "MISSING" || assertion.status === "CONFLICT") {
      triggeringRules.push(assertion.rule_id);
      triggeringCategories.add(category);
    }
  }

  const triggered = triggeringRules.length > 0;
  return {
    triggered,
    capValue: triggered ? config.floorCap : null,
    triggeringRules,
    triggeringCategories: Array.from(triggeringCategories),
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
