import { describe, it, expect } from "vitest";
import { pillarEnum } from "../../../src/agent-readiness/shared.schema";
import {
  DEFAULT_PILLAR_WEIGHTS,
  DEFAULT_SCORING_CONFIG,
  type PillarScore,
  type ScoringModel,
} from "../../../src/agent-readiness/scoring/scoring-types";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";

describe("SLICE-93-2: pillarEnum + pillar types", () => {
  describe("pillarEnum", () => {
    it("exports exactly 4 values matching spec §A.7", () => {
      const values = pillarEnum.options;
      expect(values).toEqual([
        "discovery",
        "understandability",
        "executability",
        "verifiability",
      ]);
    });

    it("rejects invalid pillar values", () => {
      expect(() => pillarEnum.parse("performance")).toThrow();
      expect(() => pillarEnum.parse("")).toThrow();
    });

    it("accepts all 4 valid pillar values", () => {
      expect(pillarEnum.parse("discovery")).toBe("discovery");
      expect(pillarEnum.parse("understandability")).toBe("understandability");
      expect(pillarEnum.parse("executability")).toBe("executability");
      expect(pillarEnum.parse("verifiability")).toBe("verifiability");
    });
  });

  describe("DEFAULT_PILLAR_WEIGHTS", () => {
    it("sums to 100 (20+25+30+25)", () => {
      const sum =
        DEFAULT_PILLAR_WEIGHTS.discovery +
        DEFAULT_PILLAR_WEIGHTS.understandability +
        DEFAULT_PILLAR_WEIGHTS.executability +
        DEFAULT_PILLAR_WEIGHTS.verifiability;
      expect(sum).toBe(100);
    });

    it("has the 4 pillar keys with spec §A.7 values", () => {
      expect(DEFAULT_PILLAR_WEIGHTS).toEqual({
        discovery: 20,
        understandability: 25,
        executability: 30,
        verifiability: 25,
      });
    });
  });

  describe("PillarScore interface", () => {
    it("mirrors CategoryScore field naming", () => {
      const ps: PillarScore = {
        pillar: "discovery",
        weight: 20,
        rawScore: 80,
        score: 80,
        categoryCount: 8,
        applicableCount: 8,
        floorTriggered: false,
      };
      expect(ps.pillar).toBe("discovery");
      expect(ps.weight).toBe(20);
      expect(ps.rawScore).toBe(80);
      expect(ps.score).toBe(80);
      expect(ps.categoryCount).toBe(8);
      expect(ps.applicableCount).toBe(8);
      expect(ps.floorTriggered).toBe(false);
    });
  });

  describe("ScoringModel type", () => {
    it("supports v1-categories and v2-pillars", () => {
      const m1: ScoringModel = "v1-categories";
      const m2: ScoringModel = "v2-pillars";
      expect(m1).toBe("v1-categories");
      expect(m2).toBe("v2-pillars");
    });
  });

  describe("DEFAULT_SCORING_CONFIG extensions", () => {
    it("has scoringModel = v2-pillars by default", () => {
      expect(DEFAULT_SCORING_CONFIG.scoringModel).toBe("v2-pillars");
    });

    it("has pillarWeights matching DEFAULT_PILLAR_WEIGHTS", () => {
      expect(DEFAULT_SCORING_CONFIG.pillarWeights).toEqual(DEFAULT_PILLAR_WEIGHTS);
    });
  });

  describe("rule.schema.ts — optional pillar field", () => {
    const baseRule = {
      rule_id: "AB-001",
      version: "1.0.0",
      name: "Test rule",
      category: "discovery" as const,
      severity: "high" as const,
      counted_in_score: true,
      check: {
        type: "http_fetch" as const,
        sources: ["https://example.com"],
      },
      fix: {
        eligible: false,
        type: "none" as const,
      },
    };

    it("parses a rule WITH pillar override", () => {
      const rule = agentReadinessRuleSchema.parse({
        ...baseRule,
        pillar: "executability",
      });
      expect(rule.pillar).toBe("executability");
    });

    it("parses a rule WITHOUT pillar (backward compat)", () => {
      const rule = agentReadinessRuleSchema.parse(baseRule);
      expect(rule.pillar).toBeUndefined();
    });

    it("rejects invalid pillar value", () => {
      expect(() =>
        agentReadinessRuleSchema.parse({
          ...baseRule,
          pillar: "performance",
        }),
      ).toThrow();
    });
  });
});
