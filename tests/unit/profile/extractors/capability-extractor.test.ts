import { describe, it, expect } from "vitest";
import { extractCapabilities } from "../../../../src/agent-readiness/profile/extractors/capability-extractor";
import { extractPaths } from "../../../../src/agent-readiness/profile/extractors/openapi-paths";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../../src/agent-readiness/rule-engine/evidence.types";
import {
  makeOpenApiEvidence,
  makeOpenApiEvidenceWithDetail,
  sampleOpenApiSpec,
  makeHttpEvidence,
  makeMcpEvidence,
} from "../fixtures/openapi-fixture";

/**
 * SLICE-101-3: Capability & Endpoint Extractor tests.
 */

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string; category: string; status: Assertion["status"]; evidence?: Evidence[] }): Assertion {
  return {
    rule_id: overrides.rule_id,
    rule_version: "2.4.0",
    status: overrides.status,
    evidence: overrides.evidence ?? [],
    confidence: overrides.confidence ?? 0.9,
    timestamp: overrides.timestamp ?? "2026-09-01T10:00:00Z",
    source_url: overrides.source_url ?? null,
    reason: overrides.reason ?? "ok",
    category: overrides.category,
    name: overrides.name ?? overrides.rule_id,
    claim: overrides.claim ?? "claim",
    verified_at: overrides.verified_at ?? "2026-09-01T10:00:00Z",
    review_level: "auto" as any,
  };
}

// ─── OpenAPI path parser ───

describe("SLICE-101-3: extractPaths — from pre-parsed arrays", () => {
  it("extracts endpoints from paths + methods arrays", () => {
    const ev = makeOpenApiEvidence(["/api/v1/tasks", "/api/v1/users"], ["GET", "POST"]);
    const paths = extractPaths(ev);
    expect(paths).toHaveLength(4);
    expect(paths[0]).toEqual({ path: "/api/v1/tasks", method: "GET", description: undefined });
  });

  it("returns empty for non-openapi evidence", () => {
    const ev = makeHttpEvidence("https://example.com");
    const paths = extractPaths(ev);
    expect(paths).toHaveLength(0);
  });
});

describe("SLICE-101-3: extractPaths — from raw spec JSON", () => {
  it("parses semantic_detail as OpenAPI spec", () => {
    const ev = makeOpenApiEvidenceWithDetail(JSON.stringify(sampleOpenApiSpec));
    const paths = extractPaths(ev);
    expect(paths).toHaveLength(5);
    expect(paths[0]).toEqual({
      path: "/api/v1/tasks",
      method: "GET",
      description: "List all tasks",
      operationId: "listTasks",
    });
  });

  it("handles invalid JSON in semantic_detail", () => {
    const ev = makeOpenApiEvidenceWithDetail("{not json}");
    const paths = extractPaths(ev);
    expect(paths).toHaveLength(0);
  });

  it("respects maxEndpoints limit", () => {
    const ev = makeOpenApiEvidenceWithDetail(JSON.stringify(sampleOpenApiSpec));
    const paths = extractPaths(ev, 2);
    expect(paths).toHaveLength(2);
  });
});

// ─── Capability extractor ───

describe("SLICE-101-3: extractCapabilities — endpoints", () => {
  it("extracts endpoints from VERIFIED openapi assertion", () => {
    const assertions: Assertion[] = [
      makeAssertion({
        rule_id: "AB-077",
        category: "openapi",
        status: "VERIFIED",
        confidence: 0.95,
        evidence: [makeOpenApiEvidence(["/api/v1/tasks"], ["GET"])],
      }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps).toBeDefined();
    expect(caps!.data.endpoints).toHaveLength(1);
    expect(caps!.data.endpoints[0].path).toBe("/api/v1/tasks");
    expect(caps!.data.endpoints[0].method).toBe("GET");
  });

  it("extracts endpoints from raw spec JSON in semantic_detail", () => {
    const assertions: Assertion[] = [
      makeAssertion({
        rule_id: "AB-077",
        category: "openapi",
        status: "VERIFIED",
        confidence: 0.95,
        evidence: [makeOpenApiEvidenceWithDetail(JSON.stringify(sampleOpenApiSpec))],
      }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps).toBeDefined();
    expect(caps!.data.endpoints).toHaveLength(5);
  });
});

describe("SLICE-101-3: extractCapabilities — protocols", () => {
  it("infers REST from openapi evidence", () => {
    const assertions: Assertion[] = [
      makeAssertion({
        rule_id: "AB-077",
        category: "openapi",
        status: "VERIFIED",
        evidence: [makeOpenApiEvidence(["/api"], ["GET"])],
      }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.data.protocols).toContain("REST");
  });

  it("infers MCP from mcp evidence", () => {
    const assertions: Assertion[] = [
      makeAssertion({
        rule_id: "AB-069",
        category: "webmcp",
        status: "VERIFIED",
        evidence: [makeMcpEvidence()],
      }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.data.protocols).toContain("MCP");
  });

  it("infers WebMCP from webmcp category", () => {
    const assertions: Assertion[] = [
      makeAssertion({
        rule_id: "AB-103",
        category: "webmcp",
        status: "VERIFIED",
        evidence: [makeHttpEvidence("https://example.com/mcp")],
      }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.data.protocols).toContain("WebMCP");
  });

  it("infers A2A from agent-card evidence", () => {
    const assertions: Assertion[] = [
      makeAssertion({
        rule_id: "AB-091",
        category: "discovery",
        status: "VERIFIED",
        evidence: [makeHttpEvidence("https://example.com/.well-known/agent-card.json")],
      }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.data.protocols).toContain("A2A");
  });
});

describe("SLICE-101-3: extractCapabilities — skills", () => {
  it("extracts skills from semantic_detail JSON", () => {
    const assertions: Assertion[] = [
      makeAssertion({
        rule_id: "AB-091",
        category: "discovery",
        status: "VERIFIED",
        evidence: [{
          type: "http",
          url: "https://example.com/.well-known/agent-card.json",
          status: 200,
          headers: {},
          content_hash: "x",
          content_type: "application/json",
          resolved_ip: null,
          source_class: "machine_readable_spec",
          semantic_detail: JSON.stringify({ skills: ["api_call", "data_provide"] }),
        } as Evidence],
      }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.data.skills).toContain("api_call");
    expect(caps!.data.skills).toContain("data_provide");
  });
});

describe("SLICE-101-3: extractCapabilities — section meta", () => {
  it("computes confidence as mean of contributing assertions", () => {
    const assertions: Assertion[] = [
      makeAssertion({ rule_id: "AB-077", category: "openapi", status: "VERIFIED", confidence: 0.9, evidence: [makeOpenApiEvidence(["/a"], ["GET"])] }),
      makeAssertion({ rule_id: "AB-091", category: "discovery", status: "VERIFIED", confidence: 0.8, evidence: [makeHttpEvidence("https://example.com")] }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.confidence).toBeCloseTo(0.85, 5);
  });

  it("source is unique evidence types", () => {
    const assertions: Assertion[] = [
      makeAssertion({ rule_id: "AB-077", category: "openapi", status: "VERIFIED", evidence: [makeOpenApiEvidence(["/a"], ["GET"])] }),
      makeAssertion({ rule_id: "AB-091", category: "discovery", status: "VERIFIED", evidence: [makeHttpEvidence("https://example.com")] }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.source).toContain("openapi");
    expect(caps!.source).toContain("http");
  });

  it("verified_at is latest contributing timestamp", () => {
    const assertions: Assertion[] = [
      makeAssertion({ rule_id: "AB-077", category: "openapi", status: "VERIFIED", timestamp: "2026-08-01T10:00:00Z", verified_at: "2026-08-01T10:00:00Z", evidence: [makeOpenApiEvidence(["/a"], ["GET"])] }),
      makeAssertion({ rule_id: "AB-091", category: "discovery", status: "VERIFIED", timestamp: "2026-09-01T10:00:00Z", verified_at: "2026-09-01T10:00:00Z", evidence: [makeHttpEvidence("https://example.com")] }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.verified_at).toBe("2026-09-01T10:00:00Z");
  });

  it("gaps contains rule_ids with GAP status", () => {
    const assertions: Assertion[] = [
      makeAssertion({ rule_id: "AB-077", category: "openapi", status: "VERIFIED", evidence: [makeOpenApiEvidence(["/a"], ["GET"])] }),
      makeAssertion({ rule_id: "AB-094", category: "documentation", status: "GAP", confidence: 0 }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.gaps).toContain("AB-094");
  });

  it("stale is false (freshness computed in 101-6)", () => {
    const assertions: Assertion[] = [
      makeAssertion({ rule_id: "AB-077", category: "openapi", status: "VERIFIED", evidence: [makeOpenApiEvidence(["/a"], ["GET"])] }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.stale).toBe(false);
  });
});

describe("SLICE-101-3: extractCapabilities — edge cases", () => {
  it("returns undefined when zero applicable assertions", () => {
    const assertions: Assertion[] = [
      makeAssertion({ rule_id: "AB-030", category: "pricing", status: "VERIFIED" }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps).toBeUndefined();
  });

  it("returns undefined for empty assertions array", () => {
    expect(extractCapabilities([])).toBeUndefined();
  });

  it("caps endpoints at 50", () => {
    const paths: string[] = [];
    for (let i = 0; i < 60; i++) paths.push(`/api/v1/item${i}`);
    const assertions: Assertion[] = [
      makeAssertion({
        rule_id: "AB-077",
        category: "openapi",
        status: "VERIFIED",
        evidence: [makeOpenApiEvidence(paths, ["GET"])],
      }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps!.data.endpoints.length).toBeLessThanOrEqual(50);
  });

  it("includes GAP-only assertions in gaps but not in confidence", () => {
    const assertions: Assertion[] = [
      makeAssertion({ rule_id: "AB-094", category: "documentation", status: "GAP", confidence: 0 }),
    ];
    const caps = extractCapabilities(assertions);
    expect(caps).toBeDefined();
    expect(caps!.gaps).toContain("AB-094");
    expect(caps!.confidence).toBe(0);
  });
});
