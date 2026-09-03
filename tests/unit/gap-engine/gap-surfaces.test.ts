import { describe, it, expect } from "vitest";
import { formatPrettyOutput } from "../../../src/agent-readiness/cli/formatters/pretty-output";
import { formatHtmlOutput } from "../../../src/agent-readiness/cli/formatters/html-output";
import type { AgentReadinessReport } from "../../../src/agent-readiness/integrity/report-serializer";
import type { Gap } from "../../../src/agent-readiness/gap-engine/gap-types";
import type { GapSummary } from "../../../src/agent-readiness/gap-engine/gap-engine";

function makeGap(overrides: Partial<Gap> = {}): Gap {
  return {
    gap_id: "gap:documentation:pricing",
    type: "documentation",
    category: "pricing",
    pillar: "understandability",
    title: "What does a call cost?",
    description: "No pricing information found",
    related_rules: ["AB-010", "AB-011", "AB-012"],
    frequency: 3,
    priority: "HIGH",
    priority_reason: "severity=high;impact=0.8;frequency=3",
    fix_hint: "assisted",
    fix_artifacts: ["/pricing.json", "/pricing"],
    evidence_refs: [],
    ...overrides,
  };
}

function makeGapSummary(overrides: Partial<GapSummary> = {}): GapSummary {
  return {
    total: 4,
    by_priority: { CRITICAL: 1, HIGH: 2, MEDIUM: 1, LOW: 0 },
    by_type: { documentation: 3, semantic: 1, capability: 0, evidence: 0 },
    ...overrides,
  };
}

function makeReportWithGaps(overrides: Partial<AgentReadinessReport> = {}): AgentReadinessReport {
  const gaps: Gap[] = [
    makeGap({ gap_id: "gap:documentation:pricing", priority: "CRITICAL", title: "What does a call cost?", category: "pricing", fix_hint: "assisted" }),
    makeGap({ gap_id: "gap:semantic:openapi", priority: "HIGH", title: "Is the API spec valid?", category: "openapi", fix_hint: "deterministic" }),
    makeGap({ gap_id: "gap:documentation:llms", priority: "MEDIUM", title: "Is there an llms.txt?", category: "documentation", fix_hint: "deterministic" }),
    makeGap({ gap_id: "gap:capability:auth", priority: "LOW", title: "Can agents authenticate?", category: "bot_auth", fix_hint: "manual" }),
  ];
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
    score: { overall: 75, grade: "C+", categories: { discovery: 80 } },
    assertions: [],
    gaps,
    gap_summary: makeGapSummary(),
    integrity: {
      content_hash: "a".repeat(64),
      signature: { algorithm: "ed25519", key_id: "default", value: "sig" },
    },
    ...overrides,
  } as AgentReadinessReport;
}

describe("SLICE-96-7: Gap surfaces", () => {
  describe("formatPrettyOutput — GAP ROADMAP section", () => {
    it("renders GAP ROADMAP header when gaps exist", () => {
      const out = formatPrettyOutput(makeReportWithGaps());
      expect(out).toContain("GAP ROADMAP");
    });

    it("renders summary line from gap_summary", () => {
      const out = formatPrettyOutput(makeReportWithGaps());
      expect(out).toContain("4 gaps");
      expect(out).toContain("1 critical");
      expect(out).toContain("2 high");
    });

    it("renders gaps in priority order (CRITICAL first)", () => {
      const out = formatPrettyOutput(makeReportWithGaps());
      const criticalPos = out.indexOf("[CRITICAL]");
      const highPos = out.indexOf("[HIGH]");
      const mediumPos = out.indexOf("[MEDIUM]");
      expect(criticalPos).toBeGreaterThan(0);
      expect(criticalPos).toBeLessThan(highPos);
      expect(highPos).toBeLessThan(mediumPos);
    });

    it("renders gap title as question phrase", () => {
      const out = formatPrettyOutput(makeReportWithGaps());
      expect(out).toContain("What does a call cost?");
    });

    it("renders fix hint for each gap", () => {
      const out = formatPrettyOutput(makeReportWithGaps());
      expect(out).toContain("fix: assisted");
      expect(out).toContain("fix: deterministic");
      expect(out).toContain("fix: manual");
    });

    it("renders [BLOCKER] prefix for CRITICAL gaps", () => {
      const out = formatPrettyOutput(makeReportWithGaps());
      expect(out).toContain("[BLOCKER]");
    });

    it("renders empty state when no gaps", () => {
      const out = formatPrettyOutput(makeReportWithGaps({
        gaps: [],
        gap_summary: { total: 0, by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, by_type: { documentation: 0, semantic: 0, capability: 0, evidence: 0 } },
      }));
      expect(out).toContain("No gaps");
    });

    it("omits GAP ROADMAP section when gaps undefined (backward compat)", () => {
      const report = makeReportWithGaps();
      delete (report as unknown as Record<string, unknown>).gaps;
      delete (report as unknown as Record<string, unknown>).gap_summary;
      const out = formatPrettyOutput(report);
      expect(out).not.toContain("GAP ROADMAP");
    });
  });

  describe("formatHtmlOutput — gap section", () => {
    it("renders gap section when gaps provided in opts", () => {
      const gaps = [
        makeGap({ priority: "CRITICAL", title: "What does a call cost?" }),
        makeGap({ priority: "HIGH", title: "Is the API spec valid?" }),
      ];
      const html = formatHtmlOutput([], {
        score: 50,
        grade: "F",
        gaps,
        gap_summary: makeGapSummary(),
      });
      expect(html).toContain("Gap Roadmap");
      expect(html).toContain("What does a call cost?");
      expect(html).toContain("Is the API spec valid?");
    });

    it("renders gaps in priority order", () => {
      const gaps = [
        makeGap({ priority: "HIGH", title: "High priority gap" }),
        makeGap({ priority: "CRITICAL", title: "Critical gap" }),
      ];
      const html = formatHtmlOutput([], { score: 50, gaps, gap_summary: makeGapSummary() });
      const criticalPos = html.indexOf("Critical gap");
      const highPos = html.indexOf("High priority gap");
      expect(criticalPos).toBeGreaterThan(0);
      expect(criticalPos).toBeLessThan(highPos);
    });

    it("omits gap section when no gaps provided (backward compat)", () => {
      const html = formatHtmlOutput([], { score: 50 });
      expect(html).not.toContain("Gap Roadmap");
    });

    it("renders empty state when gaps array is empty", () => {
      const html = formatHtmlOutput([], { score: 100, gaps: [], gap_summary: { total: 0, by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, by_type: { documentation: 0, semantic: 0, capability: 0, evidence: 0 } } });
      expect(html).toContain("No gaps");
    });
  });
});
