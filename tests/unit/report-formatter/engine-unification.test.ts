import { describe, it, expect } from "vitest";
import { formatScanReport } from "../../../src/agent-readiness/report-formatter";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import type { RulesetManifest } from "../../../src/agent-readiness/scoring/scoring-config";
import type { RuleEngineResult } from "../../../src/agent-readiness/rule-engine/rule-engine";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string }): Assertion {
  return {
    rule_version: "1.0.0",
    status: "VERIFIED",
    evidence: [],
    confidence: 1.0,
    timestamp: "2026-01-01T00:00:00Z",
    source_url: "https://example.com",
    reason: "test",
    category: "discovery",
    name: "Test Rule",
    ...overrides,
  } as Assertion;
}

function makeResult(assertions: Assertion[]): RuleEngineResult {
  return {
    assertions,
    rulesetVersion: "2.1.0",
    scannedAt: "2026-01-01T00:00:00Z",
    totalRules: assertions.length,
    applicableRules: assertions.length,
  };
}

const manifest: RulesetManifest = {
  name: AGENT_READINESS_RULESET.name,
  version: AGENT_READINESS_RULESET.version,
  scoring: AGENT_READINESS_RULESET.scoring,
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

describe("SLICE-93-7: Engine unification — formatScanReport uses runScoringEngine", () => {
  it("score equals engine output (no second math path)", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-002", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-003", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-004", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-005", status: "GAP", category: "documentation" }),
    ];
    const result = makeResult(assertions);

    const engineResult = runScoringEngine({ assertions, rulesetManifest: manifest });
    const report = formatScanReport("https://example.com", result);

    expect(report.score).toBe(engineResult.total.score);
    expect(report.grade).toBe(engineResult.total.grade);
  });

  it("naive-vs-weighted divergence: formatter returns weighted score, not naive", () => {
    // 4 VERIFIED in discovery (weight 15) + 1 MISSING in documentation (weight 15)
    // Naive: 4/5 * 100 = 80
    // Engine v2: discovery pillar=100 (weight 20), understandability=0 (weight 25) → total = 20
    const assertions = [
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-002", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-003", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-004", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-005", status: "GAP", category: "documentation" }),
    ];
    const result = makeResult(assertions);

    const report = formatScanReport("https://example.com", result);

    // Naive would be 80 — prove the formatter does NOT use naive
    expect(report.score).not.toBe(80);
    // Engine v2 score should be 20
    expect(report.score).toBe(20);
  });

  it("pillars array present with 4 entries", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-002", status: "GAP", category: "documentation" }),
    ];
    const result = makeResult(assertions);

    const report = formatScanReport("https://example.com", result);

    expect(report.pillars).toBeDefined();
    expect(Array.isArray(report.pillars)).toBe(true);
    expect(report.pillars).toHaveLength(4);
  });

  it("pillars have correct shape: pillar, label, question, weight, score, floorTriggered, categories", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery" }),
    ];
    const result = makeResult(assertions);

    const report = formatScanReport("https://example.com", result);
    const pillar = report.pillars[0];

    expect(pillar).toHaveProperty("pillar");
    expect(pillar).toHaveProperty("label");
    expect(pillar).toHaveProperty("question");
    expect(pillar).toHaveProperty("weight");
    expect(pillar).toHaveProperty("score");
    expect(pillar).toHaveProperty("floorTriggered");
    expect(pillar).toHaveProperty("categories");
    expect(Array.isArray(pillar.categories)).toBe(true);
  });

  it("legacy fields still present with compatible shapes", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-002", status: "GAP", category: "discovery" }),
    ];
    const result = makeResult(assertions);

    const report = formatScanReport("https://example.com", result);

    expect(report).toHaveProperty("score");
    expect(report).toHaveProperty("grade");
    expect(report).toHaveProperty("total_rules");
    expect(report).toHaveProperty("verified");
    expect(report).toHaveProperty("missing");
    expect(report).toHaveProperty("not_applicable");
    expect(report).toHaveProperty("skipped");
    expect(report).toHaveProperty("categories");
    expect(report).toHaveProperty("top_missing");
    expect(report).toHaveProperty("summary");
    expect(typeof report.score).toBe("number");
    expect(typeof report.grade).toBe("string");
    expect(Array.isArray(report.categories)).toBe(true);
  });

  it("floorTriggered and floorReason on report root when engine floor fires", () => {
    // 10 VERIFIED in discovery + 10 VERIFIED + 1 high-severity MISSING in documentation
    // Raw score ~42.7 > cap 40 → floorTriggered=true, score capped to 40
    const assertions = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeAssertion({ rule_id: `AB-${String(i + 1).padStart(3, "0")}`, status: "VERIFIED", category: "discovery" }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeAssertion({ rule_id: `AB-${String(i + 11).padStart(3, "0")}`, status: "VERIFIED", category: "documentation" }),
      ),
      makeAssertion({ rule_id: "AB-021", status: "GAP", category: "documentation", severity: "high" } as unknown as Partial<Assertion> & { rule_id: string }),
    ];
    const result = makeResult(assertions);

    const report = formatScanReport("https://example.com", result);

    expect(report.floorTriggered).toBe(true);
    expect(report.floorReason).toContain("Floor cap");
  });

  it("no verified/total naive math left in formatter output", () => {
    // 3 VERIFIED + 1 MISSING + 1 NOT_APPLICABLE
    // Naive: 3/5 * 100 = 60 (counts N/A in denominator)
    // Engine: only applicable rules counted, so score differs
    const assertions = [
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-002", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-003", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-004", status: "GAP", category: "discovery" }),
      makeAssertion({ rule_id: "AB-005", status: "NOT_APPLICABLE", category: "payments" }),
    ];
    const result = makeResult(assertions);

    const engineResult = runScoringEngine({ assertions, rulesetManifest: manifest });
    const report = formatScanReport("https://example.com", result);

    // Engine score should match, not naive 60
    expect(report.score).toBe(engineResult.total.score);
  });
});
