import { describe, it, expect } from "vitest";
import { checkFloor } from "../../../src/agent-readiness/scoring/floor-enforcer";
import { DEFAULT_SCORING_CONFIG, DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import { categoryEnum, severityEnum, checkTypeEnum } from "../../../src/agent-readiness/shared.schema";
import { CATEGORY_TO_PILLAR, PILLAR_CATEGORIES } from "../../../src/agent-readiness/scoring/pillar-map";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

function mockAssertion(
  ruleId: string,
  status: Assertion["status"],
  severity: string = "high",
  category: string = "discovery",
): Assertion & { severity: string; category: string } {
  return {
    rule_id: ruleId,
    rule_version: "1.0.0",
    status,
    evidence: [],
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    reason: "test",
    source_url: null,
    severity,
    category,
  } as any;
}

describe("SLICE-95-2: Critical severity + new categories", () => {
  describe("categoryEnum has 25 values", () => {
    it("includes all 7 new v0.4 categories", () => {
      const newCats = ["pricing", "rate_limits", "error_semantics", "retry_semantics", "sandbox", "versioning", "agent_policy"];
      for (const cat of newCats) {
        expect(categoryEnum.options).toContain(cat);
      }
    });

    it("has exactly 25 categories", () => {
      expect(categoryEnum.options).toHaveLength(25);
    });
  });

  describe("severityEnum includes critical", () => {
    it("accepts 'critical'", () => {
      expect(severityEnum.options).toContain("critical");
    });
  });

  describe("checkTypeEnum includes semantic_validation", () => {
    it("accepts 'semantic_validation'", () => {
      expect(checkTypeEnum.options).toContain("semantic_validation");
    });
  });

  describe("all 25 categories are pillar-mapped", () => {
    it("CATEGORY_TO_PILLAR has 25 entries", () => {
      expect(Object.keys(CATEGORY_TO_PILLAR)).toHaveLength(25);
    });

    it("every categoryEnum option is mapped", () => {
      for (const cat of categoryEnum.options) {
        expect(CATEGORY_TO_PILLAR[cat as keyof typeof CATEGORY_TO_PILLAR]).toBeDefined();
      }
    });

    it("pricing → understandability", () => {
      expect(CATEGORY_TO_PILLAR.pricing).toBe("understandability");
    });

    it("rate_limits → understandability", () => {
      expect(CATEGORY_TO_PILLAR.rate_limits).toBe("understandability");
    });

    it("error_semantics → executability", () => {
      expect(CATEGORY_TO_PILLAR.error_semantics).toBe("executability");
    });

    it("retry_semantics → executability", () => {
      expect(CATEGORY_TO_PILLAR.retry_semantics).toBe("executability");
    });

    it("sandbox → executability", () => {
      expect(CATEGORY_TO_PILLAR.sandbox).toBe("executability");
    });

    it("versioning → executability", () => {
      expect(CATEGORY_TO_PILLAR.versioning).toBe("executability");
    });

    it("agent_policy → verifiability", () => {
      expect(CATEGORY_TO_PILLAR.agent_policy).toBe("verifiability");
    });
  });

  describe("PILLAR_CATEGORIES inverse map reflects new categories", () => {
    it("understandability includes pricing and rate_limits", () => {
      expect(PILLAR_CATEGORIES.understandability).toContain("pricing");
      expect(PILLAR_CATEGORIES.understandability).toContain("rate_limits");
    });

    it("executability includes error_semantics, retry_semantics, sandbox, versioning", () => {
      expect(PILLAR_CATEGORIES.executability).toContain("error_semantics");
      expect(PILLAR_CATEGORIES.executability).toContain("retry_semantics");
      expect(PILLAR_CATEGORIES.executability).toContain("sandbox");
      expect(PILLAR_CATEGORIES.executability).toContain("versioning");
    });

    it("verifiability includes agent_policy", () => {
      expect(PILLAR_CATEGORIES.verifiability).toContain("agent_policy");
    });
  });

  describe("DEFAULT_CATEGORY_WEIGHTS has 25 entries with spec v0.4 values", () => {
    it("pricing weight is 8", () => {
      expect(DEFAULT_CATEGORY_WEIGHTS.pricing).toBe(8);
    });

    it("rate_limits weight is 6", () => {
      expect(DEFAULT_CATEGORY_WEIGHTS.rate_limits).toBe(6);
    });

    it("error_semantics weight is 5", () => {
      expect(DEFAULT_CATEGORY_WEIGHTS.error_semantics).toBe(5);
    });

    it("retry_semantics weight is 3", () => {
      expect(DEFAULT_CATEGORY_WEIGHTS.retry_semantics).toBe(3);
    });

    it("sandbox weight is 2", () => {
      expect(DEFAULT_CATEGORY_WEIGHTS.sandbox).toBe(2);
    });

    it("versioning weight is 4", () => {
      expect(DEFAULT_CATEGORY_WEIGHTS.versioning).toBe(4);
    });

    it("agent_policy weight is 4", () => {
      expect(DEFAULT_CATEGORY_WEIGHTS.agent_policy).toBe(4);
    });
  });

  describe("Critical floor enforcement", () => {
    it("critical severity GAP in any category triggers floor at cap 30", () => {
      const assertions = [
        mockAssertion("AB-001", "VERIFIED", "high", "discovery"),
        mockAssertion("AB-099", "GAP", "critical", "pricing"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.triggered).toBe(true);
      expect(result.criticalTriggered).toBe(true);
      expect(result.criticalCapValue).toBe(30);
      expect(result.capValue).toBe(30);
    });

    it("critical severity CONFLICT triggers floor regardless of category", () => {
      const assertions = [
        mockAssertion("AB-099", "CONFLICT", "critical", "sandbox"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.criticalTriggered).toBe(true);
      expect(result.capValue).toBe(30);
    });

    it("critical floor caps total at 30 even when all other rules VERIFIED", () => {
      const assertions = [
        mockAssertion("AB-001", "VERIFIED", "high", "discovery"),
        mockAssertion("AB-002", "VERIFIED", "high", "discovery"),
        mockAssertion("AB-003", "VERIFIED", "high", "documentation"),
        mockAssertion("AB-099", "GAP", "critical", "versioning"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.triggered).toBe(true);
      expect(result.capValue).toBe(30);
    });

    it("both high-floor and critical-floor triggered → min(40, 30) = 30", () => {
      const assertions = [
        mockAssertion("AB-001", "GAP", "high", "discovery"),
        mockAssertion("AB-099", "GAP", "critical", "pricing"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.triggered).toBe(true);
      expect(result.criticalTriggered).toBe(true);
      expect(result.capValue).toBe(30);
    });

    it("critical rule VERIFIED does NOT trigger floor", () => {
      const assertions = [
        mockAssertion("AB-099", "VERIFIED", "critical", "pricing"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.triggered).toBe(false);
      expect(result.criticalTriggered).toBe(false);
    });

    it("criticalTriggeringRules contains the critical rule IDs", () => {
      const assertions = [
        mockAssertion("AB-099", "GAP", "critical", "pricing"),
        mockAssertion("AB-100", "CONFLICT", "critical", "sandbox"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.criticalTriggeringRules).toContain("AB-099");
      expect(result.criticalTriggeringRules).toContain("AB-100");
    });

    it("high-severity GAP in non-floor category does NOT trigger (only critical does)", () => {
      const assertions = [
        mockAssertion("AB-005", "GAP", "high", "actionability"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.triggered).toBe(false);
    });
  });

  describe("Regression: existing rules unchanged", () => {
    it("high-severity Discovery GAP still triggers floor at 40 (no critical)", () => {
      const assertions = [
        mockAssertion("AB-001", "GAP", "high", "discovery"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.triggered).toBe(true);
      expect(result.criticalTriggered).toBe(false);
      expect(result.capValue).toBe(40);
    });

    it("all VERIFIED → no floor", () => {
      const assertions = [
        mockAssertion("AB-001", "VERIFIED", "high", "discovery"),
        mockAssertion("AB-003", "VERIFIED", "high", "documentation"),
      ];
      const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
      expect(result.triggered).toBe(false);
    });
  });
});
