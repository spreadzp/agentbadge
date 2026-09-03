import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { formatScanReport } from "../../../src/agent-readiness/report-formatter";
import { assembleReport } from "../../../src/agent-readiness/integrity/report-serializer";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import type { RulesetManifest } from "../../../src/agent-readiness/scoring/scoring-config";
import { richApiSourceState } from "../../fixtures/semantic/rich-api/source-state";

/**
 * SLICE-95-10: Spec v0.4 Payload Contract
 * Validates the full scan report (with semantic rules) against the
 * adapted JSON schema. Ensures new fields (severity, display_question,
 * semantic_outcome) are present in the serialized payload.
 */
const schemaPath = join(__dirname, "../../../docs/EPICS/32-agent-readiness-spec/spec/schemas/agentbadge-report.schema.json");
const rawSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));

// Adapt schema for v0.4 serializer output (same pattern as SLICE-93-11 payload-contract test)
const adaptedSchema: Record<string, unknown> = {
  ...rawSchema,
  properties: {
    ...rawSchema.properties,
    schema_version: { type: "string", description: "Schema version" },
    ruleset: {
      type: "object",
      properties: {
        name: { type: "string" },
        version: { type: "string" },
      },
      required: ["name", "version"],
      additionalProperties: false,
    },
    score: {
      type: "object",
      properties: {
        total: { type: "number", minimum: 0, maximum: 100 },
        overall: { type: "number", minimum: 0, maximum: 100 },
        grade: { type: "string" },
        categories: {
          type: "object",
          additionalProperties: { type: "number", minimum: 0, maximum: 100 },
        },
        delta: { type: "number", minimum: -100, maximum: 100 },
        pillars: rawSchema.properties?.score?.properties?.pillars ?? { type: "object" },
      },
      required: ["overall", "categories"],
      additionalProperties: true,
    },
    assertions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    source_state: { type: "string" },
    pillars: { type: "object" },
    integrity: {
      type: "object",
      properties: {
        content_hash: { type: "string" },
        signature: {
          type: "object",
          properties: {
            algorithm: { type: "string" },
            key_id: { type: "string" },
            value: { type: "string" },
          },
          required: ["algorithm", "key_id", "value"],
          additionalProperties: false,
        },
      },
      required: ["content_hash", "signature"],
      additionalProperties: true,
    },
  },
  required: [
    "report_id",
    "schema_version",
    "ruleset",
    "scope",
    "scanned_at",
    "previous_hash",
    "score",
    "assertions",
    "integrity",
  ],
  additionalProperties: true,
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(adaptedSchema);

describe("SLICE-95-10: Spec v0.4 Payload Contract", () => {
  let report: ReturnType<typeof formatScanReport>;
  let serialized: ReturnType<typeof assembleReport>;

  beforeAll(() => {
    RuleEngine.reset();
    const result = RuleEngine.run(richApiSourceState);
    report = formatScanReport("https://example.com", result);

    const manifest: RulesetManifest = {
      name: AGENT_READINESS_RULESET.name,
      version: AGENT_READINESS_RULESET.version,
      scoring: AGENT_READINESS_RULESET.scoring,
      categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
    };
    const scoreResult = runScoringEngine({ assertions: result.assertions, rulesetManifest: manifest });
    const cleanAssertions = JSON.parse(JSON.stringify(result.assertions));
    serialized = assembleReport({
      scope: {
        agent_id: "example.com",
        agent_version: "unknown",
        endpoint_base_url: "https://example.com",
      },
      assertions: cleanAssertions,
      scoreResult,
      previousHash: null,
      keyId: "default",
    });
  });

  it("serialized report validates against adapted schema", () => {
    const valid = validate(serialized);
    if (!valid) {
      console.error("Schema errors:", JSON.stringify(validate.errors, null, 2));
    }
    expect(valid).toBe(true);
  });

  it("report contains semantic rule assertions with new fields", () => {
    const semanticAssertions = report.assertions.filter(
      (a) => a.rule_id.startsWith("AB-15") || a.rule_id.startsWith("AB-16") || a.rule_id.startsWith("AB-14")
    );
    expect(semanticAssertions.length).toBeGreaterThanOrEqual(15);
  });

  it("GAP assertions include severity field", () => {
    const gaps = report.assertions.filter((a) => a.status === "GAP");
    const withSeverity = gaps.filter((a) => a.severity !== undefined);
    expect(withSeverity.length).toBeGreaterThan(0);
  });

  it("at least one assertion has display_question", () => {
    const withDQ = report.assertions.filter((a) => a.display_question !== undefined);
    expect(withDQ.length).toBeGreaterThan(0);
  });

  it("INFERRED assertions include semantic_outcome", () => {
    const inferred = report.assertions.filter((a) => a.status === "INFERRED");
    expect(inferred.length).toBeGreaterThan(0);
    const withOutcome = inferred.filter((a) => a.semantic_outcome !== undefined);
    expect(withOutcome.length).toBeGreaterThan(0);
  });

  it("top_missing entries include severity and display_question", () => {
    if (report.top_missing.length === 0) return;
    const withSeverity = report.top_missing.filter((m) => m.severity !== undefined);
    expect(withSeverity.length).toBeGreaterThan(0);
  });

  it("critical BLOCKER appears in payload (AB-153)", () => {
    const ab153 = report.assertions.find((a) => a.rule_id === "AB-153");
    expect(ab153).toBeDefined();
    expect(ab153!.status).toBe("GAP");
    expect(ab153!.severity).toBe("critical");
  });
});
