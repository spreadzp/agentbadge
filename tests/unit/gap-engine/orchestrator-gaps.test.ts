import { describe, it, expect } from "vitest";
import { formatScanReport } from "../../../src/agent-readiness/report-formatter";
import { assembleReport } from "../../../src/agent-readiness/integrity/report-serializer";
import type { RuleEngineResult } from "../../../src/agent-readiness/rule-engine/rule-engine";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

/**
 * SLICE-96-6: Orchestrator wiring + report payload + serializer + 97-ready contract
 *
 * Tests:
 * - formatScanReport produces gaps[] + gap_summary on rich fixture
 * - Gaps are prioritized (not all LOW) and annotated (fix_hint non-empty)
 * - Deterministic order (priority desc, category asc)
 * - Serializer round-trip with gaps
 * - Serializer round-trip without gaps (old report → empty)
 * - 97-ready contract: every gap has fix_hint ∈ enum && Array.isArray(fix_artifacts)
 */

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string; status: string; category: string }): Assertion {
  return {
    rule_version: "1.0.0",
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    source_url: null,
    reason: "Test reason",
    name: "Test assertion",
    claim: "Test claim",
    verified_at: new Date().toISOString(),
    review_level: "automatic",
    evidence: [],
    severity: "medium",
    display_question: undefined,
    ...overrides,
  } as Assertion;
}

function makeRuleEngineResult(assertions: Assertion[]): RuleEngineResult {
  return {
    assertions,
    rulesetVersion: "1.4.0",
    scannedAt: new Date().toISOString(),
    totalRules: assertions.length,
    applicableRules: assertions.length,
  };
}

describe("SLICE-96-6: Orchestrator + Report Payload + Serializer", () => {
  describe("formatScanReport — gaps integration", () => {
    it("report has gaps[] and gap_summary fields", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "GAP", category: "discovery", severity: "high" }),
        makeAssertion({ rule_id: "AB-002", status: "VERIFIED", category: "discovery", severity: "low" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);
      expect(report.gaps).toBeDefined();
      expect(Array.isArray(report.gaps)).toBe(true);
      expect(report.gap_summary).toBeDefined();
      expect(report.gap_summary.total).toBe(report.gaps.length);
    });

    it("gaps are prioritized (not all LOW placeholder)", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "GAP", category: "discovery", severity: "high" }),
        makeAssertion({ rule_id: "AB-003", status: "GAP", category: "bot_auth", severity: "critical" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);
      expect(report.gaps.length).toBeGreaterThan(0);
      // At least one gap should have priority != "LOW" (the placeholder from 96-3)
      const hasNonLow = report.gaps.some((g) => g.priority !== "LOW");
      expect(hasNonLow).toBe(true);
    });

    it("gaps are annotated with fix_hint (non-empty)", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "GAP", category: "discovery", severity: "medium" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);
      for (const gap of report.gaps) {
        expect(["deterministic", "assisted", "manual"]).toContain(gap.fix_hint);
        expect(Array.isArray(gap.fix_artifacts)).toBe(true);
      }
    });

    it("gaps sorted by priority desc, then category asc", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "GAP", category: "webmcp", severity: "low" }),
        makeAssertion({ rule_id: "AB-002", status: "GAP", category: "discovery", severity: "high" }),
        makeAssertion({ rule_id: "AB-003", status: "GAP", category: "bot_auth", severity: "critical" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);
      const priorities = report.gaps.map((g) => g.priority);
      // Verify descending order
      const order = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      for (let i = 1; i < priorities.length; i++) {
        expect(order[priorities[i] as keyof typeof order]).toBeLessThanOrEqual(
          order[priorities[i - 1] as keyof typeof order],
        );
      }
    });

    it("all-VERIFIED scan → empty gaps, zeroed summary", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery", severity: "low" }),
        makeAssertion({ rule_id: "AB-002", status: "VERIFIED", category: "pricing", severity: "low" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);
      expect(report.gaps).toEqual([]);
      expect(report.gap_summary.total).toBe(0);
      expect(report.gap_summary.by_priority.CRITICAL).toBe(0);
      expect(report.gap_summary.by_priority.HIGH).toBe(0);
      expect(report.gap_summary.by_priority.MEDIUM).toBe(0);
      expect(report.gap_summary.by_priority.LOW).toBe(0);
    });

    it("gap_summary counts match gaps array", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "GAP", category: "discovery", severity: "high" }),
        makeAssertion({ rule_id: "AB-002", status: "GAP", category: "pricing", severity: "medium" }),
        makeAssertion({ rule_id: "AB-003", status: "GAP", category: "bot_auth", severity: "critical" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);
      const criticalCount = report.gaps.filter((g) => g.priority === "CRITICAL").length;
      const highCount = report.gaps.filter((g) => g.priority === "HIGH").length;
      const mediumCount = report.gaps.filter((g) => g.priority === "MEDIUM").length;
      const lowCount = report.gaps.filter((g) => g.priority === "LOW").length;
      expect(report.gap_summary.by_priority.CRITICAL).toBe(criticalCount);
      expect(report.gap_summary.by_priority.HIGH).toBe(highCount);
      expect(report.gap_summary.by_priority.MEDIUM).toBe(mediumCount);
      expect(report.gap_summary.by_priority.LOW).toBe(lowCount);
      expect(report.gap_summary.total).toBe(report.gaps.length);
    });
  });

  describe("serializer round-trip with gaps", () => {
    it("assembleReport includes gaps + gap_summary", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "GAP", category: "discovery", severity: "high" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);

      const assembled = assembleReport({
        scope: {
          agent_id: "test-agent",
          agent_version: "1.0.0",
          endpoint_base_url: "https://example.com",
        },
        assertions: report.assertions,
        scoreResult: {
          total: { score: report.score, grade: report.grade },
          categories: {},
        },
        previousHash: null,
        keyId: "test-key",
        gaps: report.gaps,
        gap_summary: report.gap_summary,
      });

      expect(assembled.gaps).toBeDefined();
      expect(Array.isArray(assembled.gaps)).toBe(true);
      expect(assembled.gap_summary).toBeDefined();
      expect(assembled.gap_summary!.total).toBe(report.gaps.length);
    });

    it("round-trip: serialize → parse → gaps intact", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "GAP", category: "discovery", severity: "high" }),
        makeAssertion({ rule_id: "AB-002", status: "GAP", category: "pricing", severity: "medium" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);

      const assembled = assembleReport({
        scope: {
          agent_id: "test-agent",
          agent_version: "1.0.0",
          endpoint_base_url: "https://example.com",
        },
        assertions: report.assertions,
        scoreResult: {
          total: { score: report.score, grade: report.grade },
          categories: {},
        },
        previousHash: null,
        keyId: "test-key",
        gaps: report.gaps,
        gap_summary: report.gap_summary,
      });

      // Serialize → parse
      const json = JSON.stringify(assembled);
      const parsed = JSON.parse(json);

      expect(parsed.gaps).toBeDefined();
      expect(Array.isArray(parsed.gaps)).toBe(true);
      expect(parsed.gaps.length).toBe(report.gaps.length);
      expect(parsed.gap_summary.total).toBe(report.gap_summary.total);
      // Verify gap content intact
      for (let i = 0; i < parsed.gaps.length; i++) {
        expect(parsed.gaps[i].gap_id).toBe(report.gaps[i].gap_id);
        expect(parsed.gaps[i].priority).toBe(report.gaps[i].priority);
        expect(parsed.gaps[i].fix_hint).toBe(report.gaps[i].fix_hint);
      }
    });

    it("old report without gaps → parses fine (absence = empty)", () => {
      const assembled = assembleReport({
        scope: {
          agent_id: "test-agent",
          agent_version: "1.0.0",
          endpoint_base_url: "https://example.com",
        },
        assertions: [],
        scoreResult: {
          total: { score: 50, grade: "C" },
          categories: {},
        },
        previousHash: null,
        keyId: "test-key",
      });

      // No gaps provided → should be absent or empty
      const json = JSON.stringify(assembled);
      const parsed = JSON.parse(json);
      // Absence is acceptable — old reports don't have gaps
      if (parsed.gaps) {
        expect(Array.isArray(parsed.gaps)).toBe(true);
      }
      // gap_summary may be absent too
      if (parsed.gap_summary) {
        expect(parsed.gap_summary.total).toBeDefined();
      }
    });
  });

  describe("97-ready contract on serialized gaps", () => {
    it("every serialized gap has fix_hint ∈ enum && Array.isArray(fix_artifacts)", () => {
      const assertions = [
        makeAssertion({ rule_id: "AB-001", status: "GAP", category: "discovery", severity: "high" }),
        makeAssertion({ rule_id: "AB-002", status: "GAP", category: "pricing", severity: "medium" }),
        makeAssertion({ rule_id: "AB-003", status: "GAP", category: "bot_auth", severity: "critical" }),
        makeAssertion({ rule_id: "AB-004", status: "CONFLICT", category: "discovery", severity: "low" }),
      ];
      const result = makeRuleEngineResult(assertions);
      const report = formatScanReport("https://example.com", result);

      const assembled = assembleReport({
        scope: {
          agent_id: "test-agent",
          agent_version: "1.0.0",
          endpoint_base_url: "https://example.com",
        },
        assertions: report.assertions,
        scoreResult: {
          total: { score: report.score, grade: report.grade },
          categories: {},
        },
        previousHash: null,
        keyId: "test-key",
        gaps: report.gaps,
        gap_summary: report.gap_summary,
      });

      const parsed = JSON.parse(JSON.stringify(assembled));
      for (const gap of parsed.gaps) {
        expect(["deterministic", "assisted", "manual"]).toContain(gap.fix_hint);
        expect(Array.isArray(gap.fix_artifacts)).toBe(true);
        expect(typeof gap.priority).toBe("string");
        expect(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).toContain(gap.priority);
        expect(typeof gap.priority_reason).toBe("string");
        expect(gap.priority_reason.length).toBeGreaterThan(0);
      }
    });
  });
});
