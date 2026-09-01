import { describe, it, expect } from "vitest";
import type { CategoryScore, PillarWeights } from "../../../src/agent-readiness/scoring/scoring-types";
import { computePillarScores } from "../../../src/agent-readiness/scoring/pillar-scorer";
import { PILLARS } from "../../../src/agent-readiness/scoring/pillar-map";

function makeCategoryScore(
  category: string,
  score: number,
  applicableCount: number,
  weight: number,
  floorTriggered = false,
  ruleCount = 5,
): CategoryScore {
  return {
    category: category as CategoryScore["category"],
    weight,
    rawScore: score,
    score,
    ruleCount,
    applicableCount,
    floorTriggered,
  };
}

const PILLAR_WEIGHTS: PillarWeights = {
  discovery: 20,
  understandability: 25,
  executability: 30,
  verifiability: 25,
};

describe("SLICE-93-4: Pillar scorer (pure computation)", () => {
  describe("computePillarScores — full pass", () => {
    it("all categories 100 → every pillar 100", () => {
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 100, 5, 15),
        makeCategoryScore("machine_readable", 100, 3, 10),
        makeCategoryScore("openapi", 100, 4, 10),
        makeCategoryScore("skills", 100, 2, 5),
        makeCategoryScore("agents_txt", 100, 1, 3),
        makeCategoryScore("webmcp", 100, 2, 3),
        makeCategoryScore("content_negotiation", 100, 3, 5),
        makeCategoryScore("seo_aeo", 100, 2, 5),
        makeCategoryScore("documentation", 100, 4, 15),
        makeCategoryScore("actionability", 100, 3, 10),
        makeCategoryScore("accessibility", 100, 2, 4),
        makeCategoryScore("bot_auth", 100, 3, 1),
        makeCategoryScore("identity", 100, 2, 2),
        makeCategoryScore("payments", 100, 4, 10),
        makeCategoryScore("bazaar", 100, 2, 5),
        makeCategoryScore("verification", 100, 3, 5),
        makeCategoryScore("infrastructure", 100, 2, 1),
        makeCategoryScore("active_probing", 100, 3, 5),
      ];

      const result = computePillarScores({
        categoryScores: scores,
        pillarWeights: PILLAR_WEIGHTS,
      });

      expect(result).toHaveLength(4);
      for (const ps of result) {
        expect(ps.score).toBe(100);
        expect(ps.rawScore).toBe(100);
      }
    });
  });

  describe("computePillarScores — renormalization math", () => {
    it("discovery with 80(w=15) and 60(w=5) → pillar = (80×15+60×5)/(15+5) = 75", () => {
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 80, 5, 15),
        makeCategoryScore("machine_readable", 60, 3, 5),
        // other discovery categories inapplicable
        makeCategoryScore("openapi", 0, 0, 10),
        makeCategoryScore("skills", 0, 0, 5),
        makeCategoryScore("agents_txt", 0, 0, 3),
        makeCategoryScore("webmcp", 0, 0, 3),
        makeCategoryScore("content_negotiation", 0, 0, 5),
        makeCategoryScore("seo_aeo", 0, 0, 5),
        // understandability
        makeCategoryScore("documentation", 100, 4, 15),
        makeCategoryScore("actionability", 100, 3, 10),
        makeCategoryScore("accessibility", 100, 2, 4),
        // executability
        makeCategoryScore("bot_auth", 100, 3, 1),
        makeCategoryScore("identity", 100, 2, 2),
        makeCategoryScore("payments", 100, 4, 10),
        makeCategoryScore("bazaar", 100, 2, 5),
        // verifiability
        makeCategoryScore("verification", 100, 3, 5),
        makeCategoryScore("infrastructure", 100, 2, 1),
        makeCategoryScore("active_probing", 100, 3, 5),
      ];

      const result = computePillarScores({
        categoryScores: scores,
        pillarWeights: PILLAR_WEIGHTS,
      });

      const discovery = result.find((p) => p.pillar === "discovery")!;
      expect(discovery.rawScore).toBe(75);
      expect(discovery.score).toBe(75);
      expect(discovery.applicableCount).toBe(2); // only 2 categories with applicable > 0
      expect(discovery.categoryCount).toBe(8); // all 8 discovery categories provided
    });
  });

  describe("computePillarScores — inapplicable exclusion", () => {
    it("category with applicableCount=0 excluded from denominator", () => {
      // Only discovery categories, one applicable (80, w=15), one inapplicable (0, w=10)
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 80, 5, 15),
        makeCategoryScore("machine_readable", 0, 0, 10),
      ];

      const result = computePillarScores({
        categoryScores: scores,
        pillarWeights: PILLAR_WEIGHTS,
      });

      const discovery = result.find((p) => p.pillar === "discovery")!;
      // Only applicable category: (80×15)/15 = 80
      expect(discovery.rawScore).toBe(80);
      expect(discovery.applicableCount).toBe(1);
    });
  });

  describe("computePillarScores — all-inapplicable pillar", () => {
    it("score 0, applicableCount 0, no NaN", () => {
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 0, 0, 15),
        makeCategoryScore("machine_readable", 0, 0, 10),
        makeCategoryScore("documentation", 100, 4, 15),
        makeCategoryScore("actionability", 100, 3, 10),
        makeCategoryScore("accessibility", 100, 2, 4),
        makeCategoryScore("bot_auth", 100, 3, 1),
        makeCategoryScore("identity", 100, 2, 2),
        makeCategoryScore("payments", 100, 4, 10),
        makeCategoryScore("bazaar", 100, 2, 5),
        makeCategoryScore("verification", 100, 3, 5),
        makeCategoryScore("infrastructure", 100, 2, 1),
        makeCategoryScore("active_probing", 100, 3, 5),
      ];

      const result = computePillarScores({
        categoryScores: scores,
        pillarWeights: PILLAR_WEIGHTS,
      });

      const discovery = result.find((p) => p.pillar === "discovery")!;
      expect(discovery.score).toBe(0);
      expect(discovery.rawScore).toBe(0);
      expect(discovery.applicableCount).toBe(0);
      expect(Number.isNaN(discovery.score)).toBe(false);
    });
  });

  describe("computePillarScores — floor flag propagation", () => {
    it("one member category floorTriggered → pillar floorTriggered true", () => {
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 80, 5, 15, true), // floor triggered
        makeCategoryScore("machine_readable", 100, 3, 10, false),
        makeCategoryScore("documentation", 100, 4, 15, false),
        makeCategoryScore("actionability", 100, 3, 10, false),
        makeCategoryScore("accessibility", 100, 2, 4, false),
        makeCategoryScore("bot_auth", 100, 3, 1, false),
        makeCategoryScore("identity", 100, 2, 2, false),
        makeCategoryScore("payments", 100, 4, 10, false),
        makeCategoryScore("bazaar", 100, 2, 5, false),
        makeCategoryScore("verification", 100, 3, 5, false),
        makeCategoryScore("infrastructure", 100, 2, 1, false),
        makeCategoryScore("active_probing", 100, 3, 5, false),
      ];

      const result = computePillarScores({
        categoryScores: scores,
        pillarWeights: PILLAR_WEIGHTS,
      });

      const discovery = result.find((p) => p.pillar === "discovery")!;
      expect(discovery.floorTriggered).toBe(true);

      const understandability = result.find((p) => p.pillar === "understandability")!;
      expect(understandability.floorTriggered).toBe(false);
    });
  });

  describe("computePillarScores — weight independence", () => {
    it("pillar score must NOT depend on pillarWeights", () => {
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 80, 5, 15),
        makeCategoryScore("machine_readable", 60, 3, 10),
        makeCategoryScore("documentation", 100, 4, 15),
        makeCategoryScore("actionability", 100, 3, 10),
        makeCategoryScore("accessibility", 100, 2, 4),
        makeCategoryScore("bot_auth", 100, 3, 1),
        makeCategoryScore("identity", 100, 2, 2),
        makeCategoryScore("payments", 100, 4, 10),
        makeCategoryScore("bazaar", 100, 2, 5),
        makeCategoryScore("verification", 100, 3, 5),
        makeCategoryScore("infrastructure", 100, 2, 1),
        makeCategoryScore("active_probing", 100, 3, 5),
      ];

      const result1 = computePillarScores({
        categoryScores: scores,
        pillarWeights: { discovery: 20, understandability: 25, executability: 30, verifiability: 25 },
      });
      const result2 = computePillarScores({
        categoryScores: scores,
        pillarWeights: { discovery: 50, understandability: 10, executability: 20, verifiability: 20 },
      });

      for (let i = 0; i < result1.length; i++) {
        expect(result1[i].score).toBe(result2[i].score);
        expect(result1[i].rawScore).toBe(result2[i].rawScore);
      }
    });
  });

  describe("computePillarScores — output order", () => {
    it("follows PILLARS display order", () => {
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 80, 5, 15),
        makeCategoryScore("documentation", 100, 4, 15),
        makeCategoryScore("bot_auth", 100, 3, 1),
        makeCategoryScore("verification", 100, 3, 5),
      ];

      const result = computePillarScores({
        categoryScores: scores,
        pillarWeights: PILLAR_WEIGHTS,
      });

      expect(result.map((p) => p.pillar)).toEqual([...PILLARS]);
    });
  });

  describe("computePillarScores — injected map override", () => {
    it("uses injected categoryToPillar instead of default", () => {
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 80, 5, 15),
        makeCategoryScore("documentation", 100, 4, 15),
      ];

      const customMap = {
        discovery: "verifiability" as const,
        documentation: "verifiability" as const,
        machine_readable: "discovery" as const,
        openapi: "discovery" as const,
        skills: "discovery" as const,
        agents_txt: "discovery" as const,
        webmcp: "discovery" as const,
        content_negotiation: "discovery" as const,
        seo_aeo: "discovery" as const,
        actionability: "understandability" as const,
        accessibility: "understandability" as const,
        bot_auth: "executability" as const,
        identity: "executability" as const,
        payments: "executability" as const,
        bazaar: "executability" as const,
        verification: "verifiability" as const,
        infrastructure: "verifiability" as const,
        active_probing: "verifiability" as const,
      };

      const result = computePillarScores({
        categoryScores: scores,
        pillarWeights: PILLAR_WEIGHTS,
        categoryToPillar: customMap,
      });

      const verifiability = result.find((p) => p.pillar === "verifiability")!;
      expect(verifiability.categoryCount).toBe(2);
      // (80×15 + 100×15) / (15+15) = (1200+1500)/30 = 2700/30 = 90
      expect(verifiability.rawScore).toBe(90);
    });
  });

  describe("computePillarScores — pillar weight field", () => {
    it("sets pillar weight from pillarWeights", () => {
      const scores: CategoryScore[] = [
        makeCategoryScore("discovery", 80, 5, 15),
      ];

      const result = computePillarScores({
        categoryScores: scores,
        pillarWeights: PILLAR_WEIGHTS,
      });

      const discovery = result.find((p) => p.pillar === "discovery")!;
      expect(discovery.weight).toBe(20); // from PILLAR_WEIGHTS
    });
  });
});
