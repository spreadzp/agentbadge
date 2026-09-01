import { describe, it, expect } from "vitest";
import {
  type ScoringConfig,
  type CategoryScore,
  type TotalScore,
  type ScoreDelta,
  type ScoreResult,
  type CategoryWeights,
  type StatusContributions,
  type AssertionStatus,
  type PillarScore,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_STATUS_CONTRIBUTIONS,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_PILLAR_WEIGHTS,
} from "../../../src/agent-readiness/scoring/scoring-types";

describe("SLICE-35-1: Scoring Types", () => {
  it("AssertionStatus includes all 5 statuses", () => {
    const statuses: AssertionStatus[] = ["VERIFIED", "INFERRED", "CONFLICT", "GAP", "NOT_APPLICABLE"];
    expect(statuses).toHaveLength(5);
  });

  it("CategoryWeights has all original 5 categories", () => {
    const w: CategoryWeights = DEFAULT_CATEGORY_WEIGHTS;
    expect(w.discovery).toBe(15);
    expect(w.documentation).toBe(15);
    expect(w.actionability).toBe(10);
    expect(w.machine_readable).toBe(10);
    expect(w.verification).toBe(5);
  });

  it("CategoryWeights includes new seo_aeo and accessibility categories", () => {
    const w: CategoryWeights = DEFAULT_CATEGORY_WEIGHTS;
    expect(w.seo_aeo).toBeGreaterThan(0);
    expect(w.accessibility).toBeGreaterThan(0);
  });

  it("category weights sum to approximately 100", () => {
    const w = DEFAULT_CATEGORY_WEIGHTS;
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(100);
    expect(sum).toBeLessThanOrEqual(120);
  });

  it("StatusContributions has all 5 statuses", () => {
    const s: StatusContributions = DEFAULT_STATUS_CONTRIBUTIONS;
    expect(s.VERIFIED).toBe(1.0);
    expect(s.INFERRED).toBe(0.6);
    expect(s.CONFLICT).toBe(0.0);
    expect(s.GAP).toBe(0.0);
    expect(s.NOT_APPLICABLE).toBe(0.0);
  });

  it("VERIFIED contribution > INFERRED > CONFLICT = GAP", () => {
    const s = DEFAULT_STATUS_CONTRIBUTIONS;
    expect(s.VERIFIED).toBeGreaterThan(s.INFERRED);
    expect(s.INFERRED).toBeGreaterThan(s.CONFLICT);
    expect(s.CONFLICT).toBe(s.GAP);
  });

  it("DEFAULT_SCORING_CONFIG has correct floorCap", () => {
    expect(DEFAULT_SCORING_CONFIG.floorCap).toBe(40);
  });

  it("DEFAULT_SCORING_CONFIG floorCategories includes discovery and documentation", () => {
    expect(DEFAULT_SCORING_CONFIG.floorCategories).toContain("discovery");
    expect(DEFAULT_SCORING_CONFIG.floorCategories).toContain("documentation");
  });

  it("DEFAULT_SCORING_CONFIG floorTriggerSeverity includes high", () => {
    expect(DEFAULT_SCORING_CONFIG.floorTriggerSeverity).toContain("high");
  });

  it("CategoryScore interface has floorTriggered boolean", () => {
    const cs: CategoryScore = {
      category: "discovery",
      weight: 25,
      rawScore: 80,
      score: 80,
      ruleCount: 5,
      applicableCount: 5,
      floorTriggered: false,
    };
    expect(typeof cs.floorTriggered).toBe("boolean");
  });

  it("TotalScore separates rawScore from score", () => {
    const ts: TotalScore = {
      rawScore: 75,
      score: 40,
      grade: "D",
      floorTriggered: true,
      floorReason: "High-severity discovery rule GAP",
    };
    expect(ts.rawScore).not.toBe(ts.score);
    expect(ts.floorTriggered).toBe(true);
  });

  it("ScoreDelta is nullable (null when no previous report)", () => {
    const sr: ScoreResult = {
      total: { rawScore: 80, score: 80, grade: "B", floorTriggered: false, floorReason: null },
      categories: {} as Record<string, CategoryScore>,
      pillars: {} as Record<string, PillarScore>,
      delta: null,
      config: DEFAULT_SCORING_CONFIG,
      computedAt: new Date().toISOString(),
    };
    expect(sr.delta).toBeNull();
  });

  it("ScoreDelta has totalDelta, categoryDeltas, statusChanges", () => {
    const d: ScoreDelta = {
      totalDelta: 5,
      categoryDeltas: { discovery: 3 },
      pillarDeltas: { discovery: 3 },
      statusChanges: [{ ruleId: "AB-001", from: "GAP", to: "VERIFIED" }],
      items: [],
    };
    expect(d.totalDelta).toBe(5);
    expect(d.categoryDeltas.discovery).toBe(3);
    expect(d.statusChanges).toHaveLength(1);
  });

  it("ScoreResult includes config for reproducibility", () => {
    const sr: ScoreResult = {
      total: { rawScore: 80, score: 80, grade: "B", floorTriggered: false, floorReason: null },
      categories: {} as Record<string, CategoryScore>,
      pillars: {} as Record<string, PillarScore>,
      delta: null,
      config: DEFAULT_SCORING_CONFIG,
      computedAt: new Date().toISOString(),
    };
    expect(sr.config).toBe(DEFAULT_SCORING_CONFIG);
    expect(sr.config.categoryWeights.discovery).toBe(15);
  });

  it("ScoringConfig is a complete interface", () => {
    const config: ScoringConfig = {
      categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
      statusContributions: DEFAULT_STATUS_CONTRIBUTIONS,
      floorCap: 40,
      floorCategories: ["discovery", "documentation"],
      floorTriggerSeverity: ["high"],
      scoringModel: "v2-pillars",
      pillarWeights: DEFAULT_PILLAR_WEIGHTS,
    };
    expect(config.floorCap).toBe(40);
    expect(config.categoryWeights.verification).toBe(5);
  });
});
