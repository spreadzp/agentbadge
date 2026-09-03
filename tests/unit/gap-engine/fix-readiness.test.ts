import { describe, it, expect } from "vitest";
import { annotateFixReadiness } from "../../../src/agent-readiness/gap-engine/gap-fix-hints";
import type { Gap } from "../../../src/agent-readiness/gap-engine/gap-types";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import { CATEGORY_TO_PILLAR } from "../../../src/agent-readiness/scoring/pillar-map";

/**
 * SLICE-96-5: Fix Readiness Data — Hints & Artifacts per Gap
 *
 * Tests:
 * - Every gap gets non-empty fix_hint from FIX_HINT_BY_GAP_TYPE
 * - Rule fix_hint override respected (conservative wins: manual > assisted > deterministic)
 * - fix_artifacts derived from rule check targets (no phantom targets)
 * - capability/evidence → empty fix_artifacts
 * - 97-ready contract: fix_hint ∈ enum && Array.isArray(fix_artifacts)
 */

function makeGap(overrides: Partial<Gap> & { category: string; type: Gap["type"] }): Gap {
  return {
    gap_id: `gap:${overrides.type}:${overrides.category}`,
    title: "Test gap",
    description: "Test description",
    priority: "LOW",
    priority_reason: "",
    related_rules: ["AB-001"],
    evidence_refs: [],
    fix_hint: "deterministic",
    fix_artifacts: [],
    pillar: CATEGORY_TO_PILLAR[overrides.category as keyof typeof CATEGORY_TO_PILLAR],
    frequency: 1,
    ...overrides,
  };
}

function makeRule(overrides: Partial<AgentReadinessRule> & { rule_id: string; category: string }): AgentReadinessRule {
  return {
    version: "1.0.0",
    name: "Test rule",
    severity: "medium",
    counted_in_score: true,
    check: { type: "http_fetch" },
    fix: { eligible: true, type: "deterministic" },
    ...overrides,
  } as AgentReadinessRule;
}

describe("SLICE-96-5: Fix Readiness Data", () => {
  describe("fix_hint defaults", () => {
    it("documentation gap → deterministic hint", () => {
      const gap = makeGap({ category: "discovery", type: "documentation" });
      const rules = [makeRule({ rule_id: "AB-001", category: "discovery" })];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_hint).toBe("deterministic");
    });

    it("semantic gap → assisted hint", () => {
      const gap = makeGap({ category: "pricing", type: "semantic" });
      const rules = [makeRule({ rule_id: "AB-002", category: "pricing" })];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_hint).toBe("assisted");
    });

    it("capability gap → manual hint", () => {
      const gap = makeGap({ category: "bot_auth", type: "capability" });
      const rules = [makeRule({ rule_id: "AB-003", category: "bot_auth" })];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_hint).toBe("manual");
    });

    it("evidence gap → manual hint", () => {
      const gap = makeGap({ category: "discovery", type: "evidence" });
      const rules = [makeRule({ rule_id: "AB-004", category: "discovery" })];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_hint).toBe("manual");
    });
  });

  describe("fix_hint rule override", () => {
    it("rule fix_hint override respected over default", () => {
      const gap = makeGap({ category: "discovery", type: "documentation", related_rules: ["AB-010"] });
      const rules = [makeRule({ rule_id: "AB-010", category: "discovery", fix_hint: "manual" } as unknown as AgentReadinessRule)];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_hint).toBe("manual");
    });

    it("conservative wins: manual > assisted > deterministic when mixed", () => {
      const gap = makeGap({
        category: "discovery",
        type: "documentation",
        related_rules: ["AB-011", "AB-012"],
        frequency: 2,
      });
      const rules = [
        makeRule({ rule_id: "AB-011", category: "discovery", fix_hint: "deterministic" } as unknown as AgentReadinessRule),
        makeRule({ rule_id: "AB-012", category: "discovery", fix_hint: "assisted" } as unknown as AgentReadinessRule),
      ];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_hint).toBe("assisted");
    });

    it("conservative wins: manual beats both", () => {
      const gap = makeGap({
        category: "discovery",
        type: "documentation",
        related_rules: ["AB-013", "AB-014", "AB-015"],
        frequency: 3,
      });
      const rules = [
        makeRule({ rule_id: "AB-013", category: "discovery", fix_hint: "deterministic" } as unknown as AgentReadinessRule),
        makeRule({ rule_id: "AB-014", category: "discovery", fix_hint: "assisted" } as unknown as AgentReadinessRule),
        makeRule({ rule_id: "AB-015", category: "discovery", fix_hint: "manual" } as unknown as AgentReadinessRule),
      ];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_hint).toBe("manual");
    });
  });

  describe("fix_artifacts derivation", () => {
    it("artifacts derived from rule check.target — llms.txt", () => {
      const gap = makeGap({ category: "documentation", type: "documentation", related_rules: ["AB-020"] });
      const rules = [
        makeRule({ rule_id: "AB-020", category: "documentation", check: { type: "http_fetch", target: "/llms.txt" } }),
      ];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_artifacts).toContain("llms.txt");
    });

    it("artifacts derived from rule check.target — openapi.json", () => {
      const gap = makeGap({ category: "openapi", type: "documentation", related_rules: ["AB-021"] });
      const rules = [
        makeRule({ rule_id: "AB-021", category: "openapi", check: { type: "schema_validation", target: "/openapi.json" } }),
      ];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_artifacts).toContain("openapi.json");
    });

    it("artifacts from multiple contributing rules deduplicated", () => {
      const gap = makeGap({
        category: "documentation",
        type: "documentation",
        related_rules: ["AB-022", "AB-023"],
        frequency: 2,
      });
      const rules = [
        makeRule({ rule_id: "AB-022", category: "documentation", check: { type: "http_fetch", target: "/llms.txt" } }),
        makeRule({ rule_id: "AB-023", category: "documentation", check: { type: "http_fetch", target: "/llms.txt" } }),
      ];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_artifacts).toEqual(["llms.txt"]);
    });

    it("capability gap → empty fix_artifacts", () => {
      const gap = makeGap({ category: "bot_auth", type: "capability", related_rules: ["AB-024"] });
      const rules = [
        makeRule({ rule_id: "AB-024", category: "bot_auth", check: { type: "cross_evidence", sources: ["credential_security"] } }),
      ];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_artifacts).toEqual([]);
    });

    it("evidence gap → empty fix_artifacts", () => {
      const gap = makeGap({ category: "discovery", type: "evidence", related_rules: ["AB-025"] });
      const rules = [
        makeRule({ rule_id: "AB-025", category: "discovery", check: { type: "http_fetch", target: "/robots.txt" } }),
      ];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_artifacts).toEqual([]);
    });

    it("no phantom targets — only artifacts from actual rule checks", () => {
      const gap = makeGap({ category: "discovery", type: "documentation", related_rules: ["AB-026"] });
      const rules = [
        makeRule({ rule_id: "AB-026", category: "discovery", check: { type: "http_fetch", target: "/robots.txt" } }),
      ];
      const result = annotateFixReadiness([gap], rules);
      expect(result[0].fix_artifacts).toEqual(["robots.txt"]);
      expect(result[0].fix_artifacts).not.toContain("llms.txt");
    });
  });

  describe("97-ready contract", () => {
    it("every gap has fix_hint ∈ enum && Array.isArray(fix_artifacts)", () => {
      const gaps: Gap[] = [
        makeGap({ category: "discovery", type: "documentation", related_rules: ["AB-030"] }),
        makeGap({ category: "pricing", type: "semantic", related_rules: ["AB-031"] }),
        makeGap({ category: "bot_auth", type: "capability", related_rules: ["AB-032"] }),
        makeGap({ category: "discovery", type: "evidence", related_rules: ["AB-033"] }),
      ];
      const rules = [
        makeRule({ rule_id: "AB-030", category: "discovery", check: { type: "http_fetch", target: "/robots.txt" } }),
        makeRule({ rule_id: "AB-031", category: "pricing", check: { type: "content_parse", target: "/" } }),
        makeRule({ rule_id: "AB-032", category: "bot_auth", check: { type: "cross_evidence" } }),
        makeRule({ rule_id: "AB-033", category: "discovery", check: { type: "http_fetch", target: "/robots.txt" } }),
      ];
      const result = annotateFixReadiness(gaps, rules);
      for (const gap of result) {
        expect(["deterministic", "assisted", "manual"]).toContain(gap.fix_hint);
        expect(Array.isArray(gap.fix_artifacts)).toBe(true);
      }
    });
  });

  describe("empty input", () => {
    it("empty gaps → empty result", () => {
      const result = annotateFixReadiness([], []);
      expect(result).toEqual([]);
    });
  });
});
