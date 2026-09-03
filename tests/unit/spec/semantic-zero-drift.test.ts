import { describe, it, expect } from "vitest";
import { categoryEnum, severityEnum, checkTypeEnum } from "../../../src/agent-readiness/shared.schema";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import { CATEGORY_TO_PILLAR, PILLARS } from "../../../src/agent-readiness/scoring/pillar-map";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";

/**
 * SLICE-95-11: Zero-Drift Cross-Check
 * Machine-checked agreement between spec v0.4, code enums, and shipped rules.
 * Spec v0.4 §A is the canonical source; this test enforces it.
 */

const SPEC_CATEGORIES = [
  "discovery", "documentation", "actionability", "machine_readable",
  "verification", "content_negotiation", "payments", "bazaar",
  "openapi", "skills", "agents_txt", "webmcp",
  "identity", "bot_auth", "infrastructure", "seo_aeo",
  "accessibility", "active_probing",
  // v0.4
  "pricing", "rate_limits", "error_semantics", "retry_semantics",
  "sandbox", "versioning", "agent_policy",
] as const;

const SPEC_SEVERITIES = ["critical", "high", "medium", "low"] as const;

const SPEC_CHECK_TYPES = [
  "http_fetch", "schema_validation", "exact_match", "cross_evidence",
  "http_probe", "content_parse", "json_rpc", "header_check",
  "semantic_validation",
] as const;

const SEMANTIC_RULE_IDS = [
  "AB-146", "AB-147", "AB-148", "AB-149", "AB-150",
  "AB-151", "AB-152", "AB-153", "AB-154", "AB-155",
  "AB-156", "AB-157", "AB-158", "AB-159", "AB-160",
];

describe("SLICE-95-11: Zero-Drift Cross-Check — spec v0.4 ↔ code", () => {
  // ─── §A.2 Category Enum (25 values) ───

  describe("§A.2 category enum (25 values)", () => {
    it("categoryEnum has exactly 25 values matching spec", () => {
      const codeValues = categoryEnum.options;
      expect(codeValues).toHaveLength(25);
      expect(codeValues.sort()).toEqual([...SPEC_CATEGORIES].sort());
    });

    it("DEFAULT_CATEGORY_WEIGHTS covers all 25 categories", () => {
      const weighted = Object.keys(DEFAULT_CATEGORY_WEIGHTS);
      expect(weighted).toHaveLength(25);
      for (const cat of SPEC_CATEGORIES) {
        expect(DEFAULT_CATEGORY_WEIGHTS).toHaveProperty(cat);
        expect(typeof DEFAULT_CATEGORY_WEIGHTS[cat as keyof typeof DEFAULT_CATEGORY_WEIGHTS]).toBe("number");
      }
    });

    it("category weights match spec v0.4 §A.2 values", () => {
      const specWeights: Record<string, number> = {
        discovery: 15, documentation: 15, actionability: 10, machine_readable: 10,
        verification: 5, content_negotiation: 5, payments: 10, bazaar: 5,
        openapi: 10, skills: 5, agents_txt: 3, webmcp: 3,
        identity: 2, bot_auth: 1, infrastructure: 1, seo_aeo: 5,
        accessibility: 4, active_probing: 5,
        pricing: 3, rate_limits: 3, error_semantics: 3, retry_semantics: 2,
        sandbox: 1, versioning: 2, agent_policy: 2,
      };
      for (const cat of SPEC_CATEGORIES) {
        expect(DEFAULT_CATEGORY_WEIGHTS[cat as keyof typeof DEFAULT_CATEGORY_WEIGHTS]).toBe(specWeights[cat]);
      }
    });
  });

  // ─── §A.3 Severity Enum ───

  describe("§A.3 severity enum", () => {
    it("severityEnum includes critical + high/medium/low", () => {
      const codeValues = severityEnum.options;
      expect(codeValues).toHaveLength(4);
      expect(codeValues.sort()).toEqual([...SPEC_SEVERITIES].sort());
    });
  });

  // ─── §A.4 Check Type Enum ───

  describe("§A.4 check type enum", () => {
    it("checkTypeEnum includes semantic_validation (9 total)", () => {
      const codeValues = checkTypeEnum.options;
      expect(codeValues).toHaveLength(9);
      expect(codeValues.sort()).toEqual([...SPEC_CHECK_TYPES].sort());
    });
  });

  // ─── §A.8 Category → Pillar Mapping (25/25) ───

  describe("§A.8 category → pillar mapping (25/25)", () => {
    it("CATEGORY_TO_PILLAR covers all 25 categories", () => {
      const mapped = Object.keys(CATEGORY_TO_PILLAR);
      expect(mapped).toHaveLength(25);
      for (const cat of SPEC_CATEGORIES) {
        expect(CATEGORY_TO_PILLAR).toHaveProperty(cat);
      }
    });

    it("no category maps to an undefined pillar", () => {
      for (const cat of SPEC_CATEGORIES) {
        const pillar = CATEGORY_TO_PILLAR[cat as keyof typeof CATEGORY_TO_PILLAR];
        expect(pillar).toBeDefined();
        expect(PILLARS).toContain(pillar);
      }
    });

    it("pillar distribution matches spec: discovery=8, understandability=5, executability=8, verifiability=4", () => {
      const counts: Record<string, number> = {};
      for (const cat of SPEC_CATEGORIES) {
        const p = CATEGORY_TO_PILLAR[cat as keyof typeof CATEGORY_TO_PILLAR];
        counts[p] = (counts[p] || 0) + 1;
      }
      expect(counts.discovery).toBe(8);
      expect(counts.understandability).toBe(5);
      expect(counts.executability).toBe(8);
      expect(counts.verifiability).toBe(4);
    });
  });

  // ─── Semantic rules: registry, category, claim, display_question ───

  describe("semantic rules (AB-146..AB-160) integrity", () => {
    const semanticRules = AGENT_READINESS_RULESET.rules.filter((r) =>
      SEMANTIC_RULE_IDS.includes(r.rule_id)
    );

    it("all 15 semantic rules are registered", () => {
      expect(semanticRules).toHaveLength(15);
    });

    for (const ruleId of SEMANTIC_RULE_IDS) {
      it(`${ruleId}: check.semantic id exists in SEMANTIC_CHECKERS registry`, () => {
        const rule = semanticRules.find((r) => r.rule_id === ruleId);
        expect(rule).toBeDefined();
        const semanticId = (rule!.check as { semantic?: string }).semantic;
        expect(semanticId).toBeDefined();
        expect(SEMANTIC_CHECKERS).toHaveProperty(semanticId!);
      });

      it(`${ruleId}: category ∈ spec category enum`, () => {
        const rule = semanticRules.find((r) => r.rule_id === ruleId);
        expect(rule).toBeDefined();
        expect(SPEC_CATEGORIES).toContain(rule!.category);
      });

      it(`${ruleId}: name is non-empty`, () => {
        const rule = semanticRules.find((r) => r.rule_id === ruleId);
        expect(rule).toBeDefined();
        expect(rule!.name).toBeTruthy();
        expect(rule!.name.length).toBeGreaterThan(0);
      });

      it(`${ruleId}: display_question is present`, () => {
        const rule = semanticRules.find((r) => r.rule_id === ruleId);
        expect(rule).toBeDefined();
        expect(rule!.display_question).toBeTruthy();
        expect(rule!.display_question!.length).toBeGreaterThan(0);
      });
    }
  });
});
