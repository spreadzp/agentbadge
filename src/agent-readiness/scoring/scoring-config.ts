import type { ScoringConfig, CategoryWeights, ScoringModel, PillarWeights } from "./scoring-types";
import {
  DEFAULT_STATUS_CONTRIBUTIONS,
  DEFAULT_PILLAR_WEIGHTS,
} from "./scoring-types";

const DEFAULT_FLOOR_CAP = 40;
const DEFAULT_FLOOR_CATEGORIES = ["discovery", "documentation"] as const;
const DEFAULT_FLOOR_TRIGGER_SEVERITY = ["high"] as const;
const DEFAULT_SCORING_MODEL: ScoringModel = "v2-pillars";

export interface RulesetManifest {
  name: string;
  version: string;
  categoryWeights: CategoryWeights;
  scoringModel?: ScoringModel;
  pillarWeights?: PillarWeights;
}

export function loadScoringConfig(manifest: RulesetManifest): ScoringConfig {
  return {
    categoryWeights: manifest.categoryWeights,
    statusContributions: DEFAULT_STATUS_CONTRIBUTIONS,
    floorCap: DEFAULT_FLOOR_CAP,
    floorCategories: [...DEFAULT_FLOOR_CATEGORIES],
    floorTriggerSeverity: [...DEFAULT_FLOOR_TRIGGER_SEVERITY],
    scoringModel: manifest.scoringModel ?? DEFAULT_SCORING_MODEL,
    pillarWeights: manifest.pillarWeights ?? DEFAULT_PILLAR_WEIGHTS,
  };
}

export { DEFAULT_FLOOR_CAP, DEFAULT_FLOOR_CATEGORIES, DEFAULT_FLOOR_TRIGGER_SEVERITY };
