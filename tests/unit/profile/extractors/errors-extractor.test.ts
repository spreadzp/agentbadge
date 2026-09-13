import { describe, it, expect } from "vitest";
import { extractErrors } from "../../../../src/agent-readiness/profile/extractors/errors-extractor";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../../src/agent-readiness/rule-engine/evidence.types";

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string; category: string; status: Assertion["status"]; evidence?: Evidence[] }): Assertion {
  return {
    rule_id: overrides.rule_id, rule_version: "2.4.0", status: overrides.status,
    evidence: overrides.evidence ?? [], confidence: overrides.confidence ?? 0.9,
    timestamp: overrides.timestamp ?? "2026-09-01T10:00:00Z", source_url: overrides.source_url ?? null,
    reason: overrides.reason ?? "ok", category: overrides.category, name: overrides.name ?? overrides.rule_id,
    claim: overrides.claim ?? "claim", verified_at: overrides.verified_at ?? "2026-09-01T10:00:00Z",
    review_level: "auto" as any,
  };
}

function makeOpenApiEvidence(detail: string): Evidence {
  return { type: "openapi", url: "https://api.example.com/openapi.json", paths: [], methods: [],
    source_class: "machine_readable_spec", semantic_detail: detail } as Evidence;
}

function makeHttpEvidence(detail?: string): Evidence {
  return { type: "http", url: "https://api.example.com", status: 200, headers: {},
    content_hash: "x", content_type: "application/json", resolved_ip: null,
    source_class: "machine_readable_spec", semantic_detail: detail } as Evidence;
}

const specWithErrors = {
  paths: {
    "/api/v1/tasks": {
      get: { responses: { 200: {}, 400: {}, 401: {}, 404: {}, 429: {}, 500: {} } },
    },
  },
  components: { schemas: { Error: { type: "object", properties: { message: { type: "string" } } } } },
};

const specWithProblemDetails = {
  paths: { "/api/v1/tasks": { get: { responses: { 400: { content: { "application/problem+json": {} } } } } } },
};

describe("SLICE-101-5: extractErrors — standard_codes", () => {
  it("extracts error codes from OpenAPI responses", () => {
    const a = [makeAssertion({ rule_id: "AB-040", category: "error_semantics", status: "VERIFIED",
      evidence: [makeOpenApiEvidence(JSON.stringify(specWithErrors))] })];
    const errors = extractErrors(a);
    expect(errors!.data.standard_codes).toContain(400);
    expect(errors!.data.standard_codes).toContain(401);
    expect(errors!.data.standard_codes).toContain(429);
    expect(errors!.data.standard_codes).toContain(500);
  });

  it("extracts codes from detail string", () => {
    const a = [makeAssertion({ rule_id: "AB-040", category: "error_semantics", status: "VERIFIED",
      evidence: [makeHttpEvidence("Returns 400, 401, 503 on errors")] })];
    const errors = extractErrors(a);
    expect(errors!.data.standard_codes).toContain(400);
    expect(errors!.data.standard_codes).toContain(401);
    expect(errors!.data.standard_codes).toContain(503);
  });
});

describe("SLICE-101-5: extractErrors — error_schema", () => {
  it("detects RFC 9457 Problem Details", () => {
    const a = [makeAssertion({ rule_id: "AB-040", category: "error_semantics", status: "VERIFIED",
      evidence: [makeOpenApiEvidence(JSON.stringify(specWithProblemDetails))] })];
    expect(extractErrors(a)!.data.error_schema).toBe("RFC 9457 Problem Details");
  });

  it("detects custom OpenAPI Error schema", () => {
    const a = [makeAssertion({ rule_id: "AB-040", category: "error_semantics", status: "VERIFIED",
      evidence: [makeOpenApiEvidence(JSON.stringify(specWithErrors))] })];
    expect(extractErrors(a)!.data.error_schema).toBe("Custom OpenAPI Error schema");
  });
});

describe("SLICE-101-5: extractErrors — section meta + edge cases", () => {
  it("computes confidence as mean", () => {
    const a = [
      makeAssertion({ rule_id: "AB-040", category: "error_semantics", status: "VERIFIED", confidence: 0.85, evidence: [makeHttpEvidence("400 500")] }),
      makeAssertion({ rule_id: "AB-041", category: "retry_semantics", status: "VERIFIED", confidence: 0.95, evidence: [makeHttpEvidence("429")] }),
    ];
    expect(extractErrors(a)!.confidence).toBeCloseTo(0.9, 5);
  });

  it("gaps contains GAP rule_ids", () => {
    const a = [
      makeAssertion({ rule_id: "AB-040", category: "error_semantics", status: "VERIFIED", evidence: [makeHttpEvidence("400")] }),
      makeAssertion({ rule_id: "AB-041", category: "error_semantics", status: "GAP", confidence: 0 }),
    ];
    expect(extractErrors(a)!.gaps).toContain("AB-041");
  });

  it("returns undefined when zero applicable", () => {
    expect(extractErrors([makeAssertion({ rule_id: "AB-030", category: "pricing", status: "VERIFIED" })])).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(extractErrors([])).toBeUndefined();
  });
});
