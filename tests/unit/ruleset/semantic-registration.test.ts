import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import { CATEGORY_TO_PILLAR } from "../../../src/agent-readiness/scoring/pillar-map";
import type { Category, Pillar } from "../../../src/agent-readiness/shared.schema";

// All Phase-B rule IDs from SLICE-95-1 through 95-7
const PHASE_B_RULE_IDS = [
  "AB-146", "AB-147", "AB-148", "AB-149", // SLICE-95-4: OpenAPI surface
  "AB-150", "AB-151", "AB-152",           // SLICE-95-5: Pricing & rate limits
  "AB-153", "AB-154", "AB-155",           // SLICE-95-6: OpenAPI execution semantics
  "AB-156", "AB-157", "AB-158", "AB-159", "AB-160", // SLICE-95-7: Environment, policy, support
];

describe("SLICE-95-8: Ruleset Integration", () => {

  // ─── Registration ─────────────────────────────────────────────────────────
  describe("All Phase-B rules registered", () => {
    for (const ruleId of PHASE_B_RULE_IDS) {
      it(`${ruleId} is registered in AGENT_READINESS_RULESET`, () => {
        const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
        expect(found).toBeDefined();
        expect(found!.counted_in_score).toBe(true);
      });
    }

    it("each Phase-B rule appears exactly once", () => {
      for (const ruleId of PHASE_B_RULE_IDS) {
        const count = AGENT_READINESS_RULESET.rules.filter((r) => r.rule_id === ruleId).length;
        expect(count).toBe(1);
      }
    });

    it("total rule count increased by 15", () => {
      // 130 pre-Phase-B + 15 Phase-B = 145
      expect(AGENT_READINESS_RULESET.rules.length).toBeGreaterThanOrEqual(145);
    });
  });

  // ─── EPIC-125: Pact0 pattern rules ──────────────────────────────────────────
  describe("EPIC-125 rules registered", () => {
    const EPIC_125_RULE_IDS = ["AB-161", "AB-162", "AB-163", "AB-164", "AB-165"]; // grows per slice

    for (const ruleId of EPIC_125_RULE_IDS) {
      it(`${ruleId} is registered in AGENT_READINESS_RULESET`, () => {
        const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
        expect(found).toBeDefined();
        expect(found!.counted_in_score).toBe(true);
        expect(found!.check.type).toBe("semantic_validation");
      });

      it(`${ruleId} appears exactly once`, () => {
        const count = AGENT_READINESS_RULESET.rules.filter((r) => r.rule_id === ruleId).length;
        expect(count).toBe(1);
      });
    }

    it("total rule count includes EPIC-125 additions", () => {
      // 130 pre-Phase-B + 15 Phase-B + 5 EPIC-125 = 150
      expect(AGENT_READINESS_RULESET.rules.length).toBe(150);
    });
  });

  // ─── Manifest version ─────────────────────────────────────────────────────
  describe("Manifest version", () => {
    it("version is 1.5.0 (EPIC-125 additions)", () => {
      expect(AGENT_READINESS_RULESET.version).toBe("1.5.0");
    });
  });

  // ─── Checker registry validation ──────────────────────────────────────────
  describe("Every registered semantic rule's checker exists in SEMANTIC_CHECKERS", () => {
    const semanticRules = AGENT_READINESS_RULESET.rules.filter(
      (r) => r.check.type === "semantic_validation",
    );

    for (const rule of semanticRules) {
      it(`${rule.rule_id} checker "${(rule.check as { semantic: string }).semantic}" exists`, () => {
        const checkerId = (rule.check as { semantic: string }).semantic;
        expect(SEMANTIC_CHECKERS[checkerId]).toBeDefined();
        expect(typeof SEMANTIC_CHECKERS[checkerId]).toBe("function");
      });
    }
  });

  // ─── Category weights present ─────────────────────────────────────────────
  describe("Category weights for v0.4 categories", () => {
    const v04Categories: Category[] = [
      "pricing", "rate_limits", "error_semantics",
      "retry_semantics", "sandbox", "versioning", "agent_policy",
    ];

    for (const cat of v04Categories) {
      it(`category weight for "${cat}" is defined and positive`, () => {
        const weight = DEFAULT_CATEGORY_WEIGHTS[cat];
        expect(weight).toBeDefined();
        expect(typeof weight).toBe("number");
        expect(weight).toBeGreaterThan(0);
      });
    }
  });

  // ─── Pillar mapping for v0.4 categories ───────────────────────────────────
  describe("Pillar mapping for v0.4 categories", () => {
    const v04Categories: Category[] = [
      "pricing", "rate_limits", "error_semantics",
      "retry_semantics", "sandbox", "versioning", "agent_policy",
    ];

    for (const cat of v04Categories) {
      it(`category "${cat}" maps to a valid pillar`, () => {
        const pillar = CATEGORY_TO_PILLAR[cat];
        expect(pillar).toBeDefined();
        const validPillars: Pillar[] = ["discovery", "understandability", "executability", "verifiability"];
        expect(validPillars).toContain(pillar);
      });
    }
  });

  // ─── No duplicate rule IDs ────────────────────────────────────────────────
  describe("No duplicate rule IDs in ruleset", () => {
    it("all rule IDs are unique", () => {
      const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });
});
