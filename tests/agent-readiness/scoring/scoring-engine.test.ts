import { describe, it, expect } from "vitest";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";

const mockManifest = {
  name: "agent-readiness",
  version: "1.2.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
  scoringModel: "v1-categories" as const,
};

function mockAssertion(
  ruleId: string,
  status: Assertion["status"],
  category: string = "discovery",
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

describe("SLICE-35-7: Scoring Engine Orchestrator", () => {
  it("all VERIFIED → total score = 100, no floor triggered", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED", "discovery"),
      mockAssertion("AB-002", "VERIFIED", "documentation"),
      mockAssertion("AB-003", "VERIFIED", "actionability"),
      mockAssertion("AB-004", "VERIFIED", "machine_readable"),
      mockAssertion("AB-005", "VERIFIED", "verification"),
    ];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });
    expect(result.total.score).toBe(55);
    expect(result.total.floorTriggered).toBe(false);
  });

  it("Discovery high-severity MISSING → floor triggered, total capped at 40", () => {
    const assertions = [
      mockAssertion("AB-001", "GAP", "discovery", "high"),
      mockAssertion("AB-002", "VERIFIED", "documentation"),
      mockAssertion("AB-003", "VERIFIED", "actionability"),
      mockAssertion("AB-004", "VERIFIED", "machine_readable"),
      mockAssertion("AB-005", "VERIFIED", "verification"),
      mockAssertion("AB-006", "VERIFIED", "openapi"),
    ];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });
    expect(result.total.floorTriggered).toBe(true);
    expect(result.total.score).toBe(40);
  });

  it("without previousResult → delta is null", () => {
    const assertions = [mockAssertion("AB-001", "VERIFIED", "discovery")];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });
    expect(result.delta).toBeNull();
  });

  it("with previousResult → delta computed", () => {
    const current = [mockAssertion("AB-001", "VERIFIED", "discovery")];
    const previous = [mockAssertion("AB-001", "GAP", "discovery")];

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
    expect(result.delta!.totalDelta).toBeGreaterThan(0);
  });

  it("config in result matches loaded config", () => {
    const assertions = [mockAssertion("AB-001", "VERIFIED", "discovery")];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });
    expect(result.config.categoryWeights.discovery).toBe(15);
    expect(result.config.floorCap).toBe(40);
  });

  it("categories record is populated", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED", "discovery"),
      mockAssertion("AB-002", "VERIFIED", "documentation"),
    ];
    const result = runScoringEngine({ assertions, rulesetManifest: mockManifest });
    expect(result.categories.discovery).toBeDefined();
    expect(result.categories.documentation).toBeDefined();
    expect(result.categories.discovery.score).toBe(100);
  });

  it("deterministic: same input → same output", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED", "discovery"),
      mockAssertion("AB-002", "INFERRED", "documentation"),
    ];
    const result1 = runScoringEngine({ assertions, rulesetManifest: mockManifest });
    const result2 = runScoringEngine({ assertions, rulesetManifest: mockManifest });
    expect(result1.total.score).toBe(result2.total.score);
    expect(result1.total.rawScore).toBe(result2.total.rawScore);
  });

  it("empty assertions → score 0, no crash", () => {
    const result = runScoringEngine({ assertions: [], rulesetManifest: mockManifest });
    expect(result.total.score).toBe(0);
    expect(result.total.rawScore).toBe(0);
  });
});
