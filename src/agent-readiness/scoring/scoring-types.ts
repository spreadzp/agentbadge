import type { Status, Category, Severity } from "../shared.schema";

export type AssertionStatus = Status;

export interface CategoryWeights {
  discovery: number;
  documentation: number;
  actionability: number;
  machine_readable: number;
  verification: number;
  content_negotiation: number;
  payments: number;
  bazaar: number;
  openapi: number;
  skills: number;
  agents_txt: number;
  webmcp: number;
  identity: number;
  bot_auth: number;
  infrastructure: number;
  seo_aeo: number;
  accessibility: number;
  active_probing: number;
}

export interface StatusContributions {
  VERIFIED: number;
  INFERRED: number;
  CONFLICT: number;
  MISSING: number;
  NOT_APPLICABLE: number;
}

export interface ScoringConfig {
  categoryWeights: CategoryWeights;
  statusContributions: StatusContributions;
  floorCap: number;
  floorCategories: Category[];
  floorTriggerSeverity: Severity[];
}

export interface CategoryScore {
  category: Category;
  weight: number;
  rawScore: number;
  score: number;
  ruleCount: number;
  applicableCount: number;
  floorTriggered: boolean;
}

export interface TotalScore {
  rawScore: number;
  score: number;
  grade: string;
  floorTriggered: boolean;
  floorReason: string | null;
}

export interface ScoreDeltaItem {
  ruleId: string;
  category: string;
  previousStatus: AssertionStatus;
  currentStatus: AssertionStatus;
  scoreImpact: number;
}

export interface ScoreDelta {
  totalDelta: number;
  categoryDeltas: Partial<Record<Category, number>>;
  statusChanges: {
    ruleId: string;
    from: AssertionStatus;
    to: AssertionStatus;
  }[];
  items: ScoreDeltaItem[];
}

export interface ScoreResult {
  total: TotalScore;
  categories: Record<Category, CategoryScore>;
  delta: ScoreDelta | null;
  config: ScoringConfig;
  computedAt: string;
}

export const DEFAULT_CATEGORY_WEIGHTS: CategoryWeights = {
  discovery: 15,
  documentation: 15,
  actionability: 10,
  machine_readable: 10,
  verification: 5,
  content_negotiation: 5,
  payments: 10,
  bazaar: 5,
  openapi: 10,
  skills: 5,
  agents_txt: 3,
  webmcp: 3,
  identity: 2,
  bot_auth: 1,
  infrastructure: 1,
  seo_aeo: 5,
  accessibility: 4,
  active_probing: 5,
};

export const DEFAULT_STATUS_CONTRIBUTIONS: StatusContributions = {
  VERIFIED: 1.0,
  INFERRED: 0.7,
  CONFLICT: 0.0,
  MISSING: 0.0,
  NOT_APPLICABLE: 0.0,
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
  statusContributions: DEFAULT_STATUS_CONTRIBUTIONS,
  floorCap: 40,
  floorCategories: ["discovery", "documentation"],
  floorTriggerSeverity: ["high"],
};
