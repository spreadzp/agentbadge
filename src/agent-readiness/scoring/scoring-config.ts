import type { ScoringConfig, CategoryWeights, StatusContributions } from "./scoring-types";
import {
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_STATUS_CONTRIBUTIONS,
} from "./scoring-types";

const DEFAULT_FLOOR_CAP = 40;
const DEFAULT_FLOOR_CATEGORIES = ["discovery", "documentation"] as const;
const DEFAULT_FLOOR_TRIGGER_SEVERITY = ["high"] as const;

export interface RulesetManifest {
  name: string;
  version: string;
  categoryWeights: CategoryWeights;
}

export function loadScoringConfig(manifest: RulesetManifest): ScoringConfig {
  return {
    categoryWeights: manifest.categoryWeights,
    statusContributions: DEFAULT_STATUS_CONTRIBUTIONS,
    floorCap: DEFAULT_FLOOR_CAP,
    floorCategories: [...DEFAULT_FLOOR_CATEGORIES],
    floorTriggerSeverity: [...DEFAULT_FLOOR_TRIGGER_SEVERITY],
  };
}

export { DEFAULT_FLOOR_CAP, DEFAULT_FLOOR_CATEGORIES, DEFAULT_FLOOR_TRIGGER_SEVERITY };
