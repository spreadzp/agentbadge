import { describe, it, expect } from "vitest";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import {
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_PILLAR_WEIGHTS,
} from "../../../src/agent-readiness/scoring/scoring-types";

const mockManifest = {
  name: "agent-readiness",
  version: "1.3.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

function mockAssertion(
  ruleId: string,
  status: Assertion["status"],
  category: string,
  severity: string = "medium",
): Assertion & { category: string; severity: string } {
  return {
    rule_id: ruleId,
    rule_version: "1.0.0",
    status,
    evidence: [],
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    reason: "test",
    source_url: null,
    category,
    severity,
  } as unknown as Assertion & { category: string; severity: string };
}

describe("SLICE-93-5: Scoring engine pillar integration", () => {
  it("all VERIFIED across 4 pillars → pillars present (4 keys), v2 total = 100", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED", "discovery"),
      mockAssertion("AB-002", "VERIFIED", "documentation"),
      mockAssertion("AB-003", "VERIFIED", "bot_auth"),
      mockAssertion("AB-004", "VERIFIED", "verification"),
    ];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });

    expect(result.pillars).toBeDefined();
    expect(Object.keys(result.pillars)).toHaveLength(4);
    expect(result.pillars.discovery.score).toBe(100);
    expect(result.pillars.understandability.score).toBe(100);
    expect(result.pillars.executability.score).toBe(100);
    expect(result.pillars.verifiability.score).toBe(100);
    expect(result.total.score).toBe(100);
  });

  it("v1-categories mode → total = old formula, pillars still present", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED", "discovery"),
      mockAssertion("AB-002", "VERIFIED", "documentation"),
      mockAssertion("AB-003", "VERIFIED", "bot_auth"),
      mockAssertion("AB-004", "VERIFIED", "verification"),
    ];
    const v1Manifest = { ...mockManifest, scoringModel: "v1-categories" as const };
    const result = runScoringEngine({ assertions, rulesetManifest: v1Manifest });

    expect(result.pillars).toBeDefined();
    // v1 total = Σ(cs.score × cs.weight) / 100
    // (100×15 + 100×15 + 100×1 + 100×5) / 100 = 36
    expect(result.total.score).toBe(36);
  });

  it("floor: high-severity MISSING in discovery → total capped ≤ 40, pillar floorTriggered", () => {
    const assertions = [
      mockAssertion("AB-001", "MISSING", "discovery", "high"),
      mockAssertion("AB-002", "VERIFIED", "documentation"),
      mockAssertion("AB-003", "VERIFIED", "bot_auth"),
      mockAssertion("AB-004", "VERIFIED", "verification"),
    ];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });

    expect(result.total.floorTriggered).toBe(true);
    expect(result.total.score).toBeLessThanOrEqual(40);
    expect(result.pillars.discovery.floorTriggered).toBe(true);
    expect(result.pillars.understandability.floorTriggered).toBe(false);
  });

  it("INFERRED 0.6: 1 VERIFIED + 1 INFERRED → category score 80", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED", "discovery"),
      mockAssertion("AB-002", "INFERRED", "discovery"),
    ];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });

    expect(result.categories.discovery.score).toBe(80);
  });

  it("delta: two runs with changed assertions → pillarDeltas correct", () => {
    const previous = [
      mockAssertion("AB-001", "MISSING", "discovery"),
      mockAssertion("AB-002", "VERIFIED", "documentation"),
    ];
    const current = [
      mockAssertion("AB-001", "VERIFIED", "discovery"),
      mockAssertion("AB-002", "VERIFIED", "documentation"),
    ];

    const prevResult = runScoringEngine({
      assertions: previous,
      rulesetManifest: mockManifest,
    });
    const result = runScoringEngine({
      assertions: current,
      rulesetManifest: mockManifest,
      previousResult: prevResult,
      previousAssertions: previous,
    });

    expect(result.delta).not.toBeNull();
    expect(result.delta!.pillarDeltas).toBeDefined();
    // Discovery pillar improved (MISSING→VERIFIED), delta > 0
    expect(result.delta!.pillarDeltas!.discovery).toBeGreaterThan(0);
    // Understandability unchanged
    expect(result.delta!.pillarDeltas!.understandability ?? 0).toBe(0);
  });

  it("pillar weights in result config match defaults", () => {
    const assertions = [mockAssertion("AB-001", "VERIFIED", "discovery")];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });
    expect(result.config.pillarWeights).toEqual(DEFAULT_PILLAR_WEIGHTS);
    expect(result.config.scoringModel).toBe("v2-pillars");
  });
});
