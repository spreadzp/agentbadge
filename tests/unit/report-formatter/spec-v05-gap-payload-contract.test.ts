import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import type { RulesetManifest } from "../../../src/agent-readiness/scoring/scoring-config";
import { assembleReport } from "../../../src/agent-readiness/integrity/report-serializer";
import { deriveGaps, summarizeGaps } from "../../../src/agent-readiness/gap-engine/gap-engine";
import { prioritizeGaps } from "../../../src/agent-readiness/gap-engine/gap-priority";
import { annotateFixReadiness } from "../../../src/agent-readiness/gap-engine/gap-fix-hints";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import { richApiSourceState } from "../../fixtures/semantic/rich-api/source-state";

/**
 * SLICE-96-8: Spec v0.5 Gap Payload Contract
 *
 * Validates that a serialized report containing gaps[] and gap_summary
 * validates against the v0.5 A.6 JSON schema extension.
 * Pattern follows 93-11/94-10/95-10 payload contract tests.
 */

// ─── v0.5 A.6 Gap Schema (inline — extends report envelope) ───

const gapSchema = {
  type: "object",
  properties: {
    gap_id: { type: "string", pattern: "^gap:" },
    type: { type: "string", enum: ["documentation", "semantic", "capability", "evidence"] },
    title: { type: "string" },
    description: { type: "string" },
    priority: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
    priority_reason: { type: "string" },
    related_rules: { type: "array", items: { type: "string" } },
    evidence_refs: { type: "array", items: { type: "string" } },
    fix_hint: { type: "string", enum: ["deterministic", "assisted", "manual"] },
    fix_artifacts: { type: "array", items: { type: "string" } },
    pillar: { type: "string", enum: ["discovery", "understandability", "executability", "verifiability"] },
    category: { type: "string" },
    frequency: { type: "integer", minimum: 1 },
  },
  required: [
    "gap_id", "type", "title", "description", "priority", "priority_reason",
    "related_rules", "evidence_refs", "fix_hint", "fix_artifacts",
    "pillar", "category", "frequency",
  ],
  additionalProperties: false,
};

const gapSummarySchema = {
  type: "object",
  properties: {
    total: { type: "integer", minimum: 0 },
    by_priority: {
      type: "object",
      properties: {
        CRITICAL: { type: "integer", minimum: 0 },
        HIGH: { type: "integer", minimum: 0 },
        MEDIUM: { type: "integer", minimum: 0 },
        LOW: { type: "integer", minimum: 0 },
      },
      required: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      additionalProperties: false,
    },
    by_type: {
      type: "object",
      properties: {
        documentation: { type: "integer", minimum: 0 },
        semantic: { type: "integer", minimum: 0 },
        capability: { type: "integer", minimum: 0 },
        evidence: { type: "integer", minimum: 0 },
      },
      required: ["documentation", "semantic", "capability", "evidence"],
      additionalProperties: false,
    },
  },
  required: ["total", "by_priority", "by_type"],
  additionalProperties: false,
};

const reportWithGapsSchema = {
  type: "object",
  properties: {
    report_id: { type: "string" },
    schema_version: { type: "string" },
    ruleset: { type: "object" },
    scope: { type: "object" },
    scanned_at: { type: "string" },
    previous_hash: { type: ["string", "null"] },
    score: { type: "object" },
    assertions: { type: "array" },
    integrity: { type: "object" },
    gaps: { type: "array", items: gapSchema },
    gap_summary: gapSummarySchema,
  },
  required: [
    "report_id", "schema_version", "ruleset", "scope", "scanned_at",
    "previous_hash", "score", "assertions", "integrity",
  ],
  additionalProperties: true,
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(reportWithGapsSchema);

const manifest: RulesetManifest = {
  name: AGENT_READINESS_RULESET.name,
  version: AGENT_READINESS_RULESET.version,
  scoring: AGENT_READINESS_RULESET.scoring,
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

let report: ReturnType<typeof assembleReport>;

beforeAll(() => {
  RuleEngine.reset();
  const result = RuleEngine.run(richApiSourceState);
  const scoreResult = runScoringEngine({ assertions: result.assertions, rulesetManifest: manifest });

  const rawGaps = deriveGaps(result.assertions, AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[]);
  const ruleSeverities = AGENT_READINESS_RULESET.rules.map((r) => ({
    rule_id: r.rule_id,
    severity: r.severity as "critical" | "high" | "medium" | "low",
  }));
  const prioritized = prioritizeGaps(rawGaps, DEFAULT_CATEGORY_WEIGHTS, ruleSeverities);
  const annotated = annotateFixReadiness(prioritized, AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[]);
  const gapSummary = summarizeGaps(annotated);

  report = assembleReport({
    scope: {
      agent_id: "example.com",
      agent_version: "unknown",
      endpoint_base_url: "https://example.com",
    },
    sourceState: richApiSourceState,
    assertions: result.assertions,
    scoreResult: {
      total: scoreResult.total,
      categories: Object.fromEntries(
        Object.entries(scoreResult.categories).map(([k, v]) => [k, { score: v.score }]),
      ),
      pillars: scoreResult.pillars,
      delta: null,
    },
    previousHash: null,
    keyId: "default",
    gaps: annotated,
    gap_summary: gapSummary,
  });
});

describe("SLICE-96-8: Spec v0.5 gap payload contract", () => {
  it("report with gaps validates against v0.5 schema", () => {
    const valid = validate(report);
    if (!valid) {
      console.error("Schema validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("report contains gaps array", () => {
    expect(report.gaps).toBeDefined();
    expect(Array.isArray(report.gaps)).toBe(true);
    expect(report.gaps!.length).toBeGreaterThan(0);
  });

  it("report contains gap_summary", () => {
    expect(report.gap_summary).toBeDefined();
    expect(typeof report.gap_summary).toBe("object");
  });

  it("each gap has all required fields", () => {
    for (const gap of report.gaps!) {
      expect(gap.gap_id).toMatch(/^gap:/);
      expect(gap.type).toMatch(/^(documentation|semantic|capability|evidence)$/);
      expect(gap.priority).toMatch(/^(CRITICAL|HIGH|MEDIUM|LOW)$/);
      expect(gap.fix_hint).toMatch(/^(deterministic|assisted|manual)$/);
      expect(typeof gap.frequency).toBe("number");
      expect(gap.frequency).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(gap.related_rules)).toBe(true);
      expect(Array.isArray(gap.fix_artifacts)).toBe(true);
      expect(Array.isArray(gap.evidence_refs)).toBe(true);
    }
  });

  it("gap_summary has correct structure", () => {
    const gs = report.gap_summary!;
    expect(typeof gs.total).toBe("number");
    expect(gs.by_priority).toHaveProperty("CRITICAL");
    expect(gs.by_priority).toHaveProperty("HIGH");
    expect(gs.by_priority).toHaveProperty("MEDIUM");
    expect(gs.by_priority).toHaveProperty("LOW");
    expect(gs.by_type).toHaveProperty("documentation");
    expect(gs.by_type).toHaveProperty("semantic");
    expect(gs.by_type).toHaveProperty("capability");
    expect(gs.by_type).toHaveProperty("evidence");
  });

  it("gap_summary.total equals gaps.length", () => {
    expect(report.gap_summary!.total).toBe(report.gaps!.length);
  });

  it("gap_summary.by_priority sums to total", () => {
    const gs = report.gap_summary!;
    const sum = gs.by_priority.CRITICAL + gs.by_priority.HIGH + gs.by_priority.MEDIUM + gs.by_priority.LOW;
    expect(sum).toBe(gs.total);
  });

  it("gap_summary.by_type sums to total", () => {
    const gs = report.gap_summary!;
    const sum = gs.by_type.documentation + gs.by_type.semantic + gs.by_type.capability + gs.by_type.evidence;
    expect(sum).toBe(gs.total);
  });
});
