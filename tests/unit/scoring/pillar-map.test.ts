import { describe, it, expect } from "vitest";
import { categoryEnum } from "../../../src/agent-readiness/shared.schema";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import {
  CATEGORY_TO_PILLAR,
  PILLAR_CATEGORIES,
  PILLARS,
  PILLAR_LABELS,
  PILLAR_QUESTIONS,
  rulePillar,
} from "../../../src/agent-readiness/scoring/pillar-map";

describe("SLICE-93-3: Category→Pillar canonical map", () => {
  describe("CATEGORY_TO_PILLAR — completeness", () => {
    it("maps every categoryEnum option (zero orphans)", () => {
      for (const cat of categoryEnum.options) {
        expect(CATEGORY_TO_PILLAR[cat], `category "${cat}" must be mapped`).toBeDefined();
      }
    });

    it("has exactly 18 entries", () => {
      expect(Object.keys(CATEGORY_TO_PILLAR)).toHaveLength(18);
    });
  });

  describe("CATEGORY_TO_PILLAR — spec §A.8 parity", () => {
    const expected: Record<string, string> = {
      discovery: "discovery",
      machine_readable: "discovery",
      openapi: "discovery",
      skills: "discovery",
      agents_txt: "discovery",
      webmcp: "discovery",
      content_negotiation: "discovery",
      seo_aeo: "discovery",
      documentation: "understandability",
      actionability: "understandability",
      accessibility: "understandability",
      bot_auth: "executability",
      identity: "executability",
      payments: "executability",
      bazaar: "executability",
      verification: "verifiability",
      infrastructure: "verifiability",
      active_probing: "verifiability",
    };

    it("matches the hardcoded spec table exactly", () => {
      for (const [cat, pillar] of Object.entries(expected)) {
        expect(CATEGORY_TO_PILLAR[cat as keyof typeof CATEGORY_TO_PILLAR]).toBe(pillar);
      }
    });
  });

  describe("PILLAR_CATEGORIES — inverse map", () => {
    it("has 4 pillar keys", () => {
      expect(Object.keys(PILLAR_CATEGORIES)).toHaveLength(4);
    });

    it("discovery has 8 categories", () => {
      expect(PILLAR_CATEGORIES.discovery).toHaveLength(8);
    });

    it("understandability has 3 categories", () => {
      expect(PILLAR_CATEGORIES.understandability).toHaveLength(3);
    });

    it("executability has 4 categories", () => {
      expect(PILLAR_CATEGORIES.executability).toHaveLength(4);
    });

    it("verifiability has 3 categories", () => {
      expect(PILLAR_CATEGORIES.verifiability).toHaveLength(3);
    });

    it("no pillar has zero categories", () => {
      for (const pillar of PILLARS) {
        expect(PILLAR_CATEGORIES[pillar].length, `pillar "${pillar}" must have ≥1 category`).toBeGreaterThan(0);
      }
    });

    it("bijectivity: flattened + sorted inverse === all categories sorted (no dupes)", () => {
      const allCats = categoryEnum.options.slice().sort();
      const flattened = PILLARS.flatMap((p) => PILLAR_CATEGORIES[p]).sort();
      expect(flattened).toEqual(allCats);
      // no duplicates
      const unique = new Set(flattened);
      expect(unique.size).toBe(flattened.length);
    });
  });

  describe("PILLARS — display order", () => {
    it("has exactly 4 pillars in canonical order", () => {
      expect(PILLARS).toEqual([
        "discovery",
        "understandability",
        "executability",
        "verifiability",
      ]);
    });
  });

  describe("PILLAR_LABELS", () => {
    it("has human-readable labels for all 4 pillars", () => {
      expect(PILLAR_LABELS.discovery).toBe("Discovery");
      expect(PILLAR_LABELS.understandability).toBe("Understandability");
      expect(PILLAR_LABELS.executability).toBe("Executability");
      expect(PILLAR_LABELS.verifiability).toBe("Verifiability");
    });
  });

  describe("PILLAR_QUESTIONS", () => {
    it("has a question for each pillar", () => {
      for (const pillar of PILLARS) {
        expect(PILLAR_QUESTIONS[pillar], `pillar "${pillar}" must have a question`).toBeTruthy();
        expect(PILLAR_QUESTIONS[pillar].length).toBeGreaterThan(0);
      }
    });
  });

  describe("rulePillar — override precedence", () => {
    it("returns the mapped pillar when no override is present", () => {
      const rule = { category: "discovery" } as Pick<AgentReadinessRule, "category" | "pillar">;
      expect(rulePillar(rule)).toBe("discovery");
    });

    it("returns the mapped pillar for a category in a different pillar", () => {
      const rule = { category: "documentation" } as Pick<AgentReadinessRule, "category" | "pillar">;
      expect(rulePillar(rule)).toBe("understandability");
    });

    it("returns the explicit pillar override when present", () => {
      const rule = {
        category: "discovery",
        pillar: "executability",
      } as Pick<AgentReadinessRule, "category" | "pillar">;
      expect(rulePillar(rule)).toBe("executability");
    });

    it("returns the explicit pillar when category and pillar differ", () => {
      const rule = {
        category: "payments",
        pillar: "verifiability",
      } as Pick<AgentReadinessRule, "category" | "pillar">;
      expect(rulePillar(rule)).toBe("verifiability");
    });
  });
});
