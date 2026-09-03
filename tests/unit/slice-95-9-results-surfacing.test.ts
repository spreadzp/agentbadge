import { describe, it, expect } from "vitest";
import { formatPrettyOutput } from "../../src/agent-readiness/cli/formatters/pretty-output";
import type { AgentReadinessReport } from "../../src/agent-readiness/integrity/report-serializer";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";
import { formatScanReport } from "../../src/agent-readiness/report-formatter";
import { AssertionBuilder } from "../../src/agent-readiness/rule-engine/assertion-builder";
import type { AgentReadinessRule } from "../../src/agent-readiness/rule.schema";

function makeReport(overrides: Partial<AgentReadinessReport> = {}): AgentReadinessReport {
  return {
    report_id: "01HTEST0000000000000000001",
    schema_version: "0.4.0",
    ruleset: { name: "agent-readiness", version: "1.4.0" },
    scope: {
      agent_id: "example.com",
      agent_version: "unknown",
      endpoint_base_url: "https://example.com",
      timestamp: new Date().toISOString(),
    },
    scanned_at: new Date().toISOString(),
    previous_hash: null,
    score: {
      overall: 75,
      grade: "C+",
      categories: { discovery: 80, documentation: 70, actionability: 60, machine_readable: 50, verification: 90 },
    },
    assertions: [
      { rule_id: "AB-001", rule_version: "1.0.0", status: "VERIFIED", evidence: [], confidence: 0.95, timestamp: "", source_url: null, reason: "robots.txt found" },
      { rule_id: "AB-002", rule_version: "1.0.0", status: "GAP", evidence: [], confidence: 0.9, timestamp: "", source_url: "https://example.com/sitemap.xml", reason: "sitemap.xml not found" },
    ],
    integrity: {
      content_hash: "a".repeat(64),
      signature: { algorithm: "ed25519", key_id: "default", value: "sig" },
    },
    ...overrides,
  } as AgentReadinessReport;
}

// ─── CLI: display_question + [BLOCKER] ───────────────────────────

describe("SLICE-95-9: CLI pretty-output — question phrasing + BLOCKER", () => {
  it("renders display_question as title for GAP assertions", () => {
    const report = makeReport({
      assertions: [
        {
          rule_id: "AB-150",
          rule_version: "1.0.0",
          status: "GAP",
          evidence: [],
          confidence: 0.9,
          timestamp: "",
          source_url: null,
          reason: "no pricing found",
          claim: "Pricing is machine-readable and discoverable by agents",
          display_question: "What does a call cost?",
        } as never,
      ],
    });
    const out = formatPrettyOutput(report);
    expect(out).toContain("What does a call cost?");
  });

  it("falls back to claim when display_question is absent", () => {
    const report = makeReport({
      assertions: [
        {
          rule_id: "AB-002",
          rule_version: "1.0.0",
          status: "GAP",
          evidence: [],
          confidence: 0.9,
          timestamp: "",
          source_url: null,
          reason: "sitemap not found",
          claim: "sitemap.xml should be present",
        } as never,
      ],
    });
    const out = formatPrettyOutput(report);
    expect(out).toContain("sitemap.xml should be present");
  });

  it("renders [BLOCKER] prefix for critical severity GAP assertions", () => {
    const report = makeReport({
      assertions: [
        {
          rule_id: "AB-150",
          rule_version: "1.0.0",
          status: "GAP",
          evidence: [],
          confidence: 0.9,
          timestamp: "",
          source_url: null,
          reason: "no pricing found",
          claim: "Pricing is machine-readable",
          display_question: "What does a call cost?",
          severity: "critical",
        } as never,
      ],
    });
    const out = formatPrettyOutput(report);
    expect(out).toContain("[BLOCKER]");
    expect(out).toContain("What does a call cost?");
  });
});

// ─── Rule schema: display_question field ─────────────────────────

describe("SLICE-95-9: display_question on Phase-B rules", () => {
  const phaseBRuleIds = ["AB-146", "AB-147", "AB-148", "AB-149", "AB-150", "AB-151", "AB-152", "AB-153", "AB-154", "AB-155", "AB-156", "AB-157", "AB-158", "AB-159", "AB-160"];

  for (const ruleId of phaseBRuleIds) {
    it(`${ruleId} has display_question`, () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
      expect(rule).toBeDefined();
      expect(rule!.display_question).toBeTruthy();
      expect(rule!.display_question!.length).toBeGreaterThan(5);
      expect(rule!.display_question!).toContain("?");
    });
  }
});

// ─── Assertion builder: severity + display_question passthrough ──

describe("SLICE-95-9: Assertion builder passthrough", () => {
  it("passes severity and display_question from rule to assertion", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-150");
    expect(rule).toBeDefined();

    const assertion = AssertionBuilder.build({
      rule: rule as AgentReadinessRule,
      evidence: [],
      status: "GAP",
      confidence: 0.9,
      reason: "no pricing found",
    });

    expect(assertion.severity).toBe(rule!.severity);
    expect(assertion.display_question).toBe(rule!.display_question);
  });
});

// ─── Report formatter: MissingRule carries severity + display_question ──

describe("SLICE-95-9: Report formatter — MissingRule fields", () => {
  it("top_missing entries include severity and display_question for GAP assertions", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-150");
    expect(rule).toBeDefined();

    const assertion = AssertionBuilder.build({
      rule: rule as AgentReadinessRule,
      evidence: [],
      status: "GAP",
      confidence: 0.9,
      reason: "no pricing found",
    });

    const report = formatScanReport("https://example.com", {
      assertions: [assertion],
      rawEvidence: new Map(),
    } as never);

    expect(report.top_missing.length).toBeGreaterThan(0);
    const entry = report.top_missing.find((m) => m.rule_id === "AB-150");
    expect(entry).toBeDefined();
    expect(entry!.severity).toBe(rule!.severity);
    expect(entry!.display_question).toBe(rule!.display_question);
  });

  it("serialized assertions include severity, display_question, and semantic_outcome", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-150");
    expect(rule).toBeDefined();

    const assertion = AssertionBuilder.build({
      rule: rule as AgentReadinessRule,
      evidence: [{
        type: "http",
        url: "https://example.com/pricing.json",
        status: 200,
        captured_at: new Date().toISOString(),
        content_type: "application/json",
        content_hash: "a".repeat(64),
        semantic_outcome: "partial",
      } as never],
      status: "INFERRED",
      confidence: 0.7,
      reason: "partial pricing found",
    });

    const report = formatScanReport("https://example.com", {
      assertions: [assertion],
      rawEvidence: new Map(),
    } as never);

    const serialized = report.assertions.find((a) => a.rule_id === "AB-150");
    expect(serialized).toBeDefined();
    expect(serialized!.severity).toBe(rule!.severity);
    expect(serialized!.display_question).toBe(rule!.display_question);
    expect(serialized!.semantic_outcome).toBe("partial");
  });
});
