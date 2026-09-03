import { describe, it, expect } from "vitest";
import { deriveGaps, summarizeGaps } from "../../../src/agent-readiness/gap-engine/gap-engine";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

/**
 * SLICE-96-3: Gap Engine Core — deriveGaps()
 *
 * Tests:
 * - GAP assertion → gap with correct type via default map
 * - Rule gap_type override respected
 * - CONFLICT → evidence gap even when category default says otherwise
 * - Two GAP assertions same category → ONE gap, related_rules 2, frequency 2
 * - VERIFIED/INFERRED/NOT_APPLICABLE → no gap
 * - gap_id format + stability: same input twice → identical ids
 * - Title fallback chain (display_question → claim → name)
 * - Empty input → [] + zeroed summary
 * - summarizeGaps counts correct on mixed fixture
 */

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string; category: string; status: string }): Assertion {
  return {
    rule_version: "1.0.0",
    evidence: [],
    confidence: 0,
    timestamp: "2026-09-03T12:00:00Z",
    source_url: null,
    reason: "",
    name: "Test rule",
    claim: "Test claim",
    verified_at: "2026-09-03T12:00:00Z",
    review_level: "automatic" as const,
    severity: "medium",
    ...overrides,
  } as Assertion;
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

describe("SLICE-96-3: Gap Engine Core — deriveGaps()", () => {
  describe("derivation rules", () => {
    it("GAP assertion → gap with correct type via default map", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-001", category: "discovery", status: "GAP", name: "robots.txt check", claim: "robots.txt is accessible" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-001", category: "discovery" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].type).toBe("documentation");
      expect(gaps[0].gap_id).toBe("gap:documentation:discovery");
      expect(gaps[0].category).toBe("discovery");
    });

    it("rule gap_type override respected over category default", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-002", category: "discovery", status: "GAP" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-002", category: "discovery", gap_type: "semantic" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].type).toBe("semantic");
      expect(gaps[0].gap_id).toBe("gap:semantic:discovery");
    });

    it("CONFLICT → evidence gap even when category default says otherwise", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-003", category: "discovery", status: "CONFLICT", reason: "sources disagree" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-003", category: "discovery" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].type).toBe("evidence");
      expect(gaps[0].gap_id).toBe("gap:evidence:discovery");
    });

    it("VERIFIED → no gap", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-004", category: "discovery", status: "VERIFIED" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-004", category: "discovery" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(0);
    });

    it("INFERRED → no gap", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-005", category: "pricing", status: "INFERRED" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-005", category: "pricing" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(0);
    });

    it("NOT_APPLICABLE → no gap", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-006", category: "sandbox", status: "NOT_APPLICABLE" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-006", category: "sandbox" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(0);
    });

    it("INFERRED-only category → absent from output", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-007", category: "pricing", status: "INFERRED" }),
        makeAssertion({ rule_id: "AB-008", category: "discovery", status: "GAP" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-007", category: "pricing" }),
        makeRule({ rule_id: "AB-008", category: "discovery" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].category).toBe("discovery");
    });
  });

  describe("grouping", () => {
    it("two GAP assertions same category → ONE gap, related_rules 2, frequency 2", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-010", category: "documentation", status: "GAP", name: "llms.txt check", claim: "llms.txt exists" }),
        makeAssertion({ rule_id: "AB-011", category: "documentation", status: "GAP", name: "agent guide check", claim: "agent-guide.json exists" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-010", category: "documentation" }),
        makeRule({ rule_id: "AB-011", category: "documentation" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].related_rules).toHaveLength(2);
      expect(gaps[0].related_rules).toContain("AB-010");
      expect(gaps[0].related_rules).toContain("AB-011");
      expect(gaps[0].frequency).toBe(2);
    });

    it("GAP + CONFLICT same category → TWO gaps (different types)", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-012", category: "rate_limits", status: "GAP" }),
        makeAssertion({ rule_id: "AB-013", category: "rate_limits", status: "CONFLICT" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-012", category: "rate_limits" }),
        makeRule({ rule_id: "AB-013", category: "rate_limits" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toHaveLength(2);
      expect(gaps.find((g) => g.type === "semantic")).toBeDefined();
      expect(gaps.find((g) => g.type === "evidence")).toBeDefined();
    });
  });

  describe("gap_id stability", () => {
    it("same input twice → identical ids", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-001", category: "discovery", status: "GAP" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-001", category: "discovery" }),
      ];
      const gaps1 = deriveGaps(assertions, rules);
      const gaps2 = deriveGaps(assertions, rules);
      expect(gaps1[0].gap_id).toBe(gaps2[0].gap_id);
    });

    it("gap_id matches spec regex", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-001", category: "discovery", status: "GAP" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-001", category: "discovery" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps[0].gap_id).toMatch(/^gap:(documentation|semantic|capability|evidence):[a-z_]+$/);
    });

    it("deterministic sort order — by category name", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-020", category: "pricing", status: "GAP" }),
        makeAssertion({ rule_id: "AB-021", category: "discovery", status: "GAP" }),
        makeAssertion({ rule_id: "AB-022", category: "bot_auth", status: "GAP" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-020", category: "pricing" }),
        makeRule({ rule_id: "AB-021", category: "discovery" }),
        makeRule({ rule_id: "AB-022", category: "bot_auth" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      const categories = gaps.map((g) => g.category);
      expect(categories).toEqual([...categories].sort());
    });
  });

  describe("title fallback chain", () => {
    it("display_question wins over claim", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-030", category: "pricing", status: "GAP", name: "Pricing check", claim: "Machine-readable pricing exists", display_question: "What does a call cost?" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-030", category: "pricing", display_question: "What does a call cost?" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps[0].title).toBe("What does a call cost?");
    });

    it("claim wins when no display_question", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-031", category: "pricing", status: "GAP", name: "Pricing check", claim: "Machine-readable pricing exists" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-031", category: "pricing" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps[0].title).toBe("Machine-readable pricing exists");
    });

    it("name fallback when no display_question and no claim", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-032", category: "pricing", status: "GAP", name: "Pricing check", claim: "" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-032", category: "pricing", name: "Pricing check" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps[0].title).toBe("Pricing check");
    });
  });

  describe("description assembly", () => {
    it("includes claim + GAP reason", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-040", category: "pricing", status: "GAP", claim: "Machine-readable pricing exists", reason: "No pricing.json found; only prose on /pricing" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-040", category: "pricing" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps[0].description).toContain("Machine-readable pricing exists");
      expect(gaps[0].description).toContain("No pricing.json found");
    });
  });

  describe("pillar + evidence_refs", () => {
    it("pillar from pillar map", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-050", category: "pricing", status: "GAP" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-050", category: "pricing" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps[0].pillar).toBe("understandability");
    });

    it("evidence_refs collected from contributing assertions", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-060", category: "documentation", status: "GAP", evidence: [{ type: "http", url: "/llms.txt", status: 404, captured_at: "2026-09-03T12:00:00Z" } as unknown as Assertion["evidence"][number]] }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-060", category: "documentation" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps[0].evidence_refs).toHaveLength(1);
    });
  });

  describe("empty input", () => {
    it("all VERIFIED → [] + zeroed summary", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-070", category: "discovery", status: "VERIFIED" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-070", category: "discovery" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      expect(gaps).toEqual([]);
      const summary = summarizeGaps(gaps);
      expect(summary.total).toBe(0);
      expect(summary.by_priority.CRITICAL).toBe(0);
      expect(summary.by_priority.HIGH).toBe(0);
      expect(summary.by_type.documentation).toBe(0);
    });
  });

  describe("summarizeGaps", () => {
    it("counts correct on mixed fixture", () => {
      const assertions: Assertion[] = [
        makeAssertion({ rule_id: "AB-080", category: "discovery", status: "GAP" }),
        makeAssertion({ rule_id: "AB-081", category: "pricing", status: "GAP" }),
        makeAssertion({ rule_id: "AB-082", category: "bot_auth", status: "GAP" }),
        makeAssertion({ rule_id: "AB-083", category: "rate_limits", status: "CONFLICT" }),
      ];
      const rules: AgentReadinessRule[] = [
        makeRule({ rule_id: "AB-080", category: "discovery" }),
        makeRule({ rule_id: "AB-081", category: "pricing" }),
        makeRule({ rule_id: "AB-082", category: "bot_auth" }),
        makeRule({ rule_id: "AB-083", category: "rate_limits" }),
      ];
      const gaps = deriveGaps(assertions, rules);
      const summary = summarizeGaps(gaps);
      expect(summary.total).toBe(4);
      expect(summary.by_type.documentation).toBe(1);
      expect(summary.by_type.semantic).toBe(1);
      expect(summary.by_type.capability).toBe(1);
      expect(summary.by_type.evidence).toBe(1);
    });
  });
});
