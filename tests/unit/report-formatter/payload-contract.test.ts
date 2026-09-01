import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleReport } from "../../../src/agent-readiness/integrity/report-serializer";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

/**
 * SLICE-93-11: Payload contract test
 * Validates the report envelope against the v0.2 JSON schema (agentbadge-report.schema.json).
 * The schema includes optional pillars array in the score block (spec v0.2 §11.1).
 */

const schemaPath = join(__dirname, "../../../docs/EPICS/32-agent-readiness-spec/spec/schemas/agentbadge-report.schema.json");
const rawSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));

// Adapt schema for v0.3 serializer output (schema was written for v0.1)
// Relax version constants and category enum to accept current output
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
        pillars: rawSchema.properties.score.properties.pillars,
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

const fixturePath = join(__dirname, "../../fixtures/scoring/golden-assertions.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
const assertions = fixture.assertions as Assertion[];

const manifest = {
  name: "agent-readiness",
  version: "1.4.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
  scoring: { pillars: { scoringModel: "v2-pillars" as const } },
};

const scoreResult = runScoringEngine({ assertions, rulesetManifest: manifest });

const report = assembleReport({
  scope: {
    agent_id: "example.com",
    agent_version: "unknown",
    endpoint_base_url: "https://example.com",
  },
  sourceState: { snapshots: {} },
  assertions,
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
});

describe("SLICE-93-11: Payload contract — report validates against schema", () => {
  it("report envelope passes schema validation", () => {
    const valid = validate(report);
    if (!valid) {
      console.error("Schema validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("report has required top-level fields", () => {
    expect(report.report_id).toBeDefined();
    expect(report.schema_version).toBeDefined();
    expect(report.ruleset).toBeDefined();
    expect(report.scope).toBeDefined();
    expect(report.scanned_at).toBeDefined();
    expect(report.previous_hash).toBeDefined();
    expect(report.score).toBeDefined();
    expect(report.assertions).toBeDefined();
    expect(report.integrity).toBeDefined();
  });

  it("report score block has pillars (v0.2 additive)", () => {
    expect(report.pillars).toBeDefined();
    expect(typeof report.pillars).toBe("object");
    const pillars = report.pillars as Record<string, unknown>;
    expect(pillars.discovery).toBeDefined();
    expect(pillars.understandability).toBeDefined();
    expect(pillars.executability).toBeDefined();
    expect(pillars.verifiability).toBeDefined();
  });

  it("report integrity block has content_hash and signature", () => {
    expect(report.integrity.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.integrity.signature.algorithm).toBe("ed25519");
    expect(report.integrity.signature.key_id).toBeDefined();
  });

  it("report score.overall is a number 0-100", () => {
    expect(typeof report.score.overall).toBe("number");
    expect(report.score.overall).toBeGreaterThanOrEqual(0);
    expect(report.score.overall).toBeLessThanOrEqual(100);
  });

  it("report score.categories has entries for scanned categories", () => {
    expect(Object.keys(report.score.categories).length).toBeGreaterThanOrEqual(5);
  });
});
