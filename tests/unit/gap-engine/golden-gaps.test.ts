import { describe, it, expect, beforeAll } from "vitest";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import { richApiSourceState } from "../../fixtures/semantic/rich-api/source-state";
import { deriveGaps, summarizeGaps } from "../../../src/agent-readiness/gap-engine/gap-engine";
import { prioritizeGaps } from "../../../src/agent-readiness/gap-engine/gap-priority";
import { annotateFixReadiness } from "../../../src/agent-readiness/gap-engine/gap-fix-hints";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import type { Gap } from "../../../src/agent-readiness/gap-engine/gap-types";
import { formatJsonApiOutput } from "../../../src/agent-readiness/cli/formatters/json-api-output";
import { formatPrettyOutput } from "../../../src/agent-readiness/cli/formatters/pretty-output";
import { formatHtmlOutput } from "../../../src/agent-readiness/cli/formatters/html-output";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import type { RulesetManifest } from "../../../src/agent-readiness/scoring/scoring-config";
import type { GapSummary } from "../../../src/agent-readiness/gap-engine/gap-engine";

/**
 * SLICE-96-8: Golden Gap Fixture
 *
 * Full pipeline (rule engine → scoring → gap engine) on the rich-API fixture.
 * Hand-documented expected gap set derived from fixture design + spec §8 derivation rules.
 *
 * ─── Expected Gaps (12 total) ───
 *
 * #  gap_id                          priority   type          freq  related_rules
 * 1  gap:evidence:actionability      CRITICAL   evidence      1     AB-007
 * 2  gap:capability:bot_auth         CRITICAL   capability    17    AB-023,AB-128..AB-145,AB-153
 * 3  gap:semantic:actionability      HIGH       semantic      2     AB-074,AB-075
 * 4  gap:documentation:discovery     HIGH       documentation 2     AB-111,AB-114
 * 5  gap:semantic:error_semantics    HIGH       semantic      1     AB-149
 * 6  gap:semantic:verification       HIGH       semantic      1     AB-152
 * 7  gap:semantic:agent_policy       MEDIUM     semantic      1     AB-157
 * 8  gap:capability:identity         MEDIUM     capability    2     AB-057,AB-112
 * 9  gap:documentation:openapi       MEDIUM     documentation 1     AB-077
 * 10 gap:semantic:rate_limits        MEDIUM     semantic      1     AB-151
 * 11 gap:semantic:retry_semantics    MEDIUM     semantic      1     AB-154
 * 12 gap:documentation:webmcp        LOW        documentation 1     AB-102
 *
 * ─── Expected Summary ───
 * total: 12
 * by_priority: { CRITICAL: 2, HIGH: 4, MEDIUM: 5, LOW: 1 }
 * by_type: { documentation: 3, semantic: 6, capability: 2, evidence: 1 }
 *
 * ─── Priority Spot-Checks ───
 * - bot_auth gap: CRITICAL (severity=critical, floor applied)
 * - pricing/verification gap: HIGH (severity=medium, impact top quartile +1)
 * - rate_limits gap: MEDIUM (severity=high, impact bottom quartile -1)
 */

function runGapPipeline(assertions: ReturnType<typeof RuleEngine.run>["assertions"]): Gap[] {
  const rawGaps = deriveGaps(assertions, AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[]);
  const ruleSeverities = AGENT_READINESS_RULESET.rules.map((r) => ({
    rule_id: r.rule_id,
    severity: r.severity as "critical" | "high" | "medium" | "low",
  }));
  const prioritized = prioritizeGaps(rawGaps, DEFAULT_CATEGORY_WEIGHTS, ruleSeverities);
  return annotateFixReadiness(prioritized, AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[]);
}

// ─── Hand-written expected gap set ───

interface ExpectedGap {
  gap_id: string;
  priority: string;
  type: string;
  frequency: number;
  related_rules: string[];
  fix_hint: string;
}

const EXPECTED_GAPS: ExpectedGap[] = [
  { gap_id: "gap:evidence:actionability", priority: "CRITICAL", type: "evidence", frequency: 1, related_rules: ["AB-007"], fix_hint: "manual" },
  { gap_id: "gap:capability:bot_auth", priority: "CRITICAL", type: "capability", frequency: 17, related_rules: ["AB-023", "AB-128", "AB-129", "AB-130", "AB-131", "AB-132", "AB-133", "AB-134", "AB-136", "AB-137", "AB-138", "AB-139", "AB-141", "AB-142", "AB-143", "AB-145", "AB-153"], fix_hint: "manual" },
  { gap_id: "gap:semantic:actionability", priority: "HIGH", type: "semantic", frequency: 2, related_rules: ["AB-074", "AB-075"], fix_hint: "assisted" },
  { gap_id: "gap:documentation:discovery", priority: "HIGH", type: "documentation", frequency: 2, related_rules: ["AB-111", "AB-114"], fix_hint: "deterministic" },
  { gap_id: "gap:semantic:error_semantics", priority: "HIGH", type: "semantic", frequency: 1, related_rules: ["AB-149"], fix_hint: "assisted" },
  { gap_id: "gap:semantic:verification", priority: "HIGH", type: "semantic", frequency: 1, related_rules: ["AB-152"], fix_hint: "assisted" },
  { gap_id: "gap:semantic:agent_policy", priority: "MEDIUM", type: "semantic", frequency: 1, related_rules: ["AB-157"], fix_hint: "assisted" },
  { gap_id: "gap:capability:identity", priority: "MEDIUM", type: "capability", frequency: 2, related_rules: ["AB-057", "AB-112"], fix_hint: "manual" },
  { gap_id: "gap:documentation:openapi", priority: "MEDIUM", type: "documentation", frequency: 1, related_rules: ["AB-077"], fix_hint: "deterministic" },
  { gap_id: "gap:semantic:rate_limits", priority: "MEDIUM", type: "semantic", frequency: 1, related_rules: ["AB-151"], fix_hint: "assisted" },
  { gap_id: "gap:semantic:retry_semantics", priority: "MEDIUM", type: "semantic", frequency: 1, related_rules: ["AB-154"], fix_hint: "assisted" },
  { gap_id: "gap:documentation:webmcp", priority: "LOW", type: "documentation", frequency: 1, related_rules: ["AB-102"], fix_hint: "deterministic" },
];

const EXPECTED_SUMMARY: GapSummary = {
  total: 12,
  by_priority: { CRITICAL: 2, HIGH: 4, MEDIUM: 5, LOW: 1 },
  by_type: { documentation: 3, semantic: 6, capability: 2, evidence: 1 },
};

describe("SLICE-96-8: Golden Gap Fixture — exact gap set on rich-API fixture", () => {
  let gaps: Gap[];
  let summary: GapSummary;

  beforeAll(() => {
    RuleEngine.reset();
    const result = RuleEngine.run(richApiSourceState);
    gaps = runGapPipeline(result.assertions);
    summary = summarizeGaps(gaps);
  });

  // ─── Gap count ───

  it("produces exactly 12 gaps", () => {
    expect(gaps).toHaveLength(12);
  });

  // ─── Exact gap set: ids, types, priorities, frequencies, related_rules ───

  describe("each gap matches hand-written expectation", () => {
    for (const expected of EXPECTED_GAPS) {
      it(`${expected.gap_id} → ${expected.priority}/${expected.type} freq=${expected.frequency}`, () => {
        const gap = gaps.find((g) => g.gap_id === expected.gap_id);
        expect(gap).toBeDefined();
        expect(gap!.priority).toBe(expected.priority);
        expect(gap!.type).toBe(expected.type);
        expect(gap!.frequency).toBe(expected.frequency);
        expect(gap!.related_rules).toEqual(expected.related_rules);
        expect(gap!.fix_hint).toBe(expected.fix_hint);
      });
    }
  });

  // ─── No unexpected gaps ───

  it("no extra gaps beyond expected set", () => {
    const expectedIds = new Set(EXPECTED_GAPS.map((g) => g.gap_id));
    const extraIds = gaps.filter((g) => !expectedIds.has(g.gap_id)).map((g) => g.gap_id);
    expect(extraIds).toEqual([]);
  });

  // ─── Summary ───

  it("gap_summary total matches", () => {
    expect(summary.total).toBe(EXPECTED_SUMMARY.total);
  });

  it("gap_summary by_priority matches exactly", () => {
    expect(summary.by_priority).toEqual(EXPECTED_SUMMARY.by_priority);
  });

  it("gap_summary by_type matches exactly", () => {
    expect(summary.by_type).toEqual(EXPECTED_SUMMARY.by_type);
  });

  // ─── Priority spot-checks (explainability locked) ───

  it("bot_auth gap is CRITICAL with floor reason in priority_reason", () => {
    const gap = gaps.find((g) => g.gap_id === "gap:capability:bot_auth");
    expect(gap).toBeDefined();
    expect(gap!.priority).toBe("CRITICAL");
    expect(gap!.priority_reason).toContain("severity=critical");
    expect(gap!.priority_reason).toContain("floor=CRITICAL");
  });

  it("verification gap is HIGH with impact trace in priority_reason", () => {
    const gap = gaps.find((g) => g.gap_id === "gap:semantic:verification");
    expect(gap).toBeDefined();
    expect(gap!.priority).toBe("HIGH");
    expect(gap!.priority_reason).toContain("severity=medium");
    expect(gap!.priority_reason).toContain("top quartile");
  });

  it("rate_limits gap is MEDIUM with bottom quartile trace", () => {
    const gap = gaps.find((g) => g.gap_id === "gap:semantic:rate_limits");
    expect(gap).toBeDefined();
    expect(gap!.priority).toBe("MEDIUM");
    expect(gap!.priority_reason).toContain("severity=high");
    expect(gap!.priority_reason).toContain("bottom quartile");
  });

  it("evidence:actionability gap is CRITICAL (CONFLICT-derived)", () => {
    const gap = gaps.find((g) => g.gap_id === "gap:evidence:actionability");
    expect(gap).toBeDefined();
    expect(gap!.priority).toBe("CRITICAL");
    expect(gap!.type).toBe("evidence");
  });

  // ─── Deterministic ordering (priority sort) ───

  it("gaps are ordered by priority: CRITICAL → HIGH → MEDIUM → LOW", () => {
    const priorityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    for (let i = 1; i < gaps.length; i++) {
      const prev = priorityOrder[gaps[i - 1].priority] ?? 9;
      const curr = priorityOrder[gaps[i].priority] ?? 9;
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });
});

// ─── Surface Sweep: web/CLI/MCP parity on the same fixture ───

describe("SLICE-96-8: Surface sweep — gap parity across CLI outputs", () => {
  let pipelineGaps: Gap[];
  let pipelineSummary: GapSummary;
  let scoreResult: ReturnType<typeof runScoringEngine>;
  let assertions: ReturnType<typeof RuleEngine.run>["assertions"];

  beforeAll(() => {
    RuleEngine.reset();
    const result = RuleEngine.run(richApiSourceState);
    assertions = result.assertions;
    const manifest: RulesetManifest = {
      name: AGENT_READINESS_RULESET.name,
      version: AGENT_READINESS_RULESET.version,
      scoring: AGENT_READINESS_RULESET.scoring,
      categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
    };
    scoreResult = runScoringEngine({ assertions, rulesetManifest: manifest });
    pipelineGaps = runGapPipeline(assertions);
    pipelineSummary = summarizeGaps(pipelineGaps);
  });

  it("JSON API output contains the same gap ids as the pipeline", () => {
    const json = formatJsonApiOutput({
      url: "https://example.com",
      score: scoreResult.total.score,
      grade: "B",
      assertions,
      categoryScores: Object.values(scoreResult.categories),
      gaps: pipelineGaps,
      gap_summary: pipelineSummary,
    });
    const parsed = JSON.parse(json);
    expect(parsed.gaps).toBeDefined();
    expect(parsed.gap_summary).toBeDefined();
    const jsonGapIds = parsed.gaps.map((g: { gap_id: string }) => g.gap_id).sort();
    const pipelineGapIds = pipelineGaps.map((g) => g.gap_id).sort();
    expect(jsonGapIds).toEqual(pipelineGapIds);
  });

  it("pretty output contains GAP ROADMAP section with all gap categories", () => {
    const pretty = formatPrettyOutput({
      report_id: "test-report",
      schema_version: "0.5",
      ruleset: { name: "agent-readiness", version: "1.4.0" },
      scope: { agent_id: "example.com", agent_version: "unknown", endpoint_base_url: "https://example.com" },
      scanned_at: "2025-01-15T00:00:00Z",
      previous_hash: null,
      score: { overall: scoreResult.total.score, categories: {}, grade: "B" },
      assertions,
      integrity: { content_hash: "a".repeat(64), signature: { algorithm: "ed25519", key_id: "default", value: "b".repeat(64) } },
      gaps: pipelineGaps,
      gap_summary: pipelineSummary,
    } as unknown as Parameters<typeof formatPrettyOutput>[0]);

    expect(pretty).toContain("GAP ROADMAP");
    // Pretty output renders gap titles and categories — verify each gap's category appears
    for (const gap of pipelineGaps) {
      expect(pretty).toContain(gap.category);
    }
    // Verify summary line
    expect(pretty).toContain(`${pipelineSummary.total} gaps`);
  });

  it("HTML output contains gap section with all gap categories", () => {
    const html = formatHtmlOutput(
      assertions,
      {
        score: scoreResult.total.score,
        grade: "B",
        reportUrl: "https://agentbadge.xyz/r/test",
        gaps: pipelineGaps,
        gap_summary: pipelineSummary,
      },
    );

    expect(html).toContain("Gap Roadmap");
    for (const gap of pipelineGaps) {
      expect(html).toContain(gap.category);
    }
  });
});
