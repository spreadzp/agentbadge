import type { ScoringConfig, CategoryWeights, ScoringModel, PillarWeights } from "./scoring-types";
import type { Category, Pillar } from "../shared.schema";
import type { SourceClass } from "../rule-engine/source-hierarchy";
import { DEFAULT_FRESHNESS_THRESHOLDS } from "../rule-engine/freshness";
import {
  DEFAULT_STATUS_CONTRIBUTIONS,
  DEFAULT_PILLAR_WEIGHTS,
} from "./scoring-types";
import { PILLARS } from "./pillar-map";

const DEFAULT_FLOOR_CAP = 40;
const DEFAULT_FLOOR_CATEGORIES = ["discovery", "documentation"] as const;
const DEFAULT_FLOOR_TRIGGER_SEVERITY = ["high"] as const;
const DEFAULT_SCORING_MODEL: ScoringModel = "v2-pillars";

export interface PillarsConfig {
  weights?: Partial<PillarWeights>;
  categoryToPillar?: Partial<Record<Category, Pillar>>;
  scoringModel?: ScoringModel;
}

export interface ScoringSection {
  pillars?: PillarsConfig;
}

export interface FreshnessConfig {
  thresholds?: Partial<Record<SourceClass, number>>;
}

export interface EvidenceSection {
  freshness?: FreshnessConfig;
}

export interface RulesetManifest {
  name: string;
  version: string;
  categoryWeights: CategoryWeights;
  scoringModel?: ScoringModel;
  pillarWeights?: PillarWeights;
  scoring?: ScoringSection;
  evidence?: EvidenceSection;
}

function resolvePillarWeights(manifest: RulesetManifest): PillarWeights {
  const scoringWeights = manifest.scoring?.pillars?.weights;
  const topLevel = manifest.pillarWeights;
  const result = { ...DEFAULT_PILLAR_WEIGHTS };

  if (topLevel) {
    Object.assign(result, topLevel);
  }
  if (scoringWeights) {
    for (const [key, value] of Object.entries(scoringWeights)) {
      if (!PILLARS.includes(key as Pillar)) {
        throw new Error(`Invalid pillar name in scoring.pillars.weights: "${key}"`);
      }
      if (typeof value !== "number" || value <= 0) {
        throw new Error(`Invalid pillar weight for "${key}": must be a positive number, got ${value}`);
      }
      (result as Record<string, number>)[key] = value;
    }
  }

  return result;
}

function resolveScoringModel(manifest: RulesetManifest): ScoringModel {
  const scoringModel = manifest.scoring?.pillars?.scoringModel;
  const topLevel = manifest.scoringModel;

  if (scoringModel) {
    if (scoringModel !== "v1-categories" && scoringModel !== "v2-pillars") {
      throw new Error(`Invalid scoringModel: "${scoringModel}" (expected "v1-categories" or "v2-pillars")`);
    }
    return scoringModel;
  }
  if (topLevel) {
    return topLevel;
  }
  return DEFAULT_SCORING_MODEL;
}

export function resolveFreshnessThresholds(manifest: RulesetManifest): Record<SourceClass, number> {
  const overrides = manifest.evidence?.freshness?.thresholds;
  if (!overrides) return { ...DEFAULT_FRESHNESS_THRESHOLDS };
  return { ...DEFAULT_FRESHNESS_THRESHOLDS, ...overrides };
}

export function loadScoringConfig(manifest: RulesetManifest): ScoringConfig {
  return {
    categoryWeights: manifest.categoryWeights,
    statusContributions: DEFAULT_STATUS_CONTRIBUTIONS,
    floorCap: DEFAULT_FLOOR_CAP,
    floorCategories: [...DEFAULT_FLOOR_CATEGORIES],
    floorTriggerSeverity: [...DEFAULT_FLOOR_TRIGGER_SEVERITY],
    scoringModel: resolveScoringModel(manifest),
    pillarWeights: resolvePillarWeights(manifest),
  };
}

export { DEFAULT_FLOOR_CAP, DEFAULT_FLOOR_CATEGORIES, DEFAULT_FLOOR_TRIGGER_SEVERITY };
