import { describe, it, expect } from "vitest";
import { AssertionBuilder } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { classifyEvidence } from "../../../src/agent-readiness/rule-engine/source-hierarchy";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockRule(overrides: Partial<AgentReadinessRule> = {}): AgentReadinessRule {
  return {
    rule_id: "AB-001",
    version: "1.0.0",
    name: "Robots.txt File",
    category: "discovery",
    severity: "medium",
    counted_in_score: true,
    check: { type: "http_fetch", target: "robots" },
    fix: { eligible: true, type: "deterministic" },
    ...overrides,
  };
}

const httpEvidence: Evidence = {
  type: "http",
  url: "https://example.com/api",
  status: 200,
  headers: {},
  content_hash: "abc123",
  content_type: "application/json",
  resolved_ip: "1.2.3.4",
  captured_at: "2026-01-15T10:00:00Z",
  source_class: "runtime",
} as Evidence;

const openApiEvidence: Evidence = {
  type: "openapi",
  url: "https://example.com/openapi.json",
  paths: ["/api"],
  methods: ["GET"],
  captured_at: "2026-01-15T11:00:00Z",
  source_class: "machine_readable_spec",
} as Evidence;

const robotsEvidence: Evidence = {
  type: "robots",
  url: "https://example.com/robots.txt",
  status: 200,
  allows_all: true,
  disallowed_paths: [],
  captured_at: "2026-01-15T09:00:00Z",
  source_class: "machine_readable_guide",
} as Evidence;

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("SLICE-94-4: Evidence Timestamps + Claim + verified_at", () => {
  // ─── Evidence V2 Fields ─────────────────────────────────────────────────────

  describe("Evidence V2 fields (captured_at, source_class)", () => {
    it("HttpEvidence accepts captured_at", () => {
      expect(httpEvidence.captured_at).toBe("2026-01-15T10:00:00Z");
    });

    it("HttpEvidence accepts source_class", () => {
      expect(httpEvidence.source_class).toBe("runtime");
    });

    it("OpenApiEvidence accepts captured_at", () => {
      expect(openApiEvidence.captured_at).toBe("2026-01-15T11:00:00Z");
    });

    it("OpenApiEvidence accepts source_class", () => {
      expect(openApiEvidence.source_class).toBe("machine_readable_spec");
    });

    it("evidence without captured_at/source_class still valid (legacy)", () => {
      const legacy: Evidence = {
        type: "http",
        url: "https://example.com/api",
        status: 200,
        headers: {},
        content_hash: "abc",
        content_type: "text/html",
        resolved_ip: null,
      } as Evidence;
      expect(legacy.captured_at).toBeUndefined();
      expect(legacy.source_class).toBeUndefined();
    });

    it("source_class matches classifyEvidence for openapi", () => {
      expect(classifyEvidence(openApiEvidence)).toBe("machine_readable_spec");
      expect(openApiEvidence.source_class).toBe(classifyEvidence(openApiEvidence));
    });

    it("source_class matches classifyEvidence for http + http_probe", () => {
      const httpProbe: Evidence = {
        type: "http",
        url: "https://example.com/api",
        status: 200,
        headers: {},
        content_hash: "abc",
        content_type: "application/json",
        resolved_ip: "1.2.3.4",
        source_class: "runtime",
      } as Evidence;
      expect(classifyEvidence(httpProbe, "http_probe")).toBe("runtime");
      expect(httpProbe.source_class).toBe("runtime");
    });
  });

  // ─── Assertion claim ────────────────────────────────────────────────────────

  describe("Assertion.claim", () => {
    it("build sets claim field", () => {
      const assertion = AssertionBuilder.build({
        rule: mockRule(),
        evidence: [httpEvidence],
        status: "VERIFIED",
        confidence: 0.9,
        reason: "robots.txt found",
      });
      expect(assertion.claim).toBeDefined();
      expect(typeof assertion.claim).toBe("string");
      expect(assertion.claim.length).toBeGreaterThan(0);
    });

    it("explicit claim input wins", () => {
      const assertion = AssertionBuilder.build({
        rule: mockRule(),
        evidence: [httpEvidence],
        status: "VERIFIED",
        confidence: 0.9,
        reason: "robots.txt found",
        claim: "Custom claim text",
      });
      expect(assertion.claim).toBe("Custom claim text");
    });

    it("claim defaults to rule name when no description available", () => {
      const assertion = AssertionBuilder.build({
        rule: mockRule({ name: "My Rule" }),
        evidence: [],
        status: "GAP",
        confidence: 0,
        reason: "No evidence",
      });
      expect(assertion.claim).toBe("My Rule");
    });
  });

  // ─── Assertion verified_at ──────────────────────────────────────────────────

  describe("Assertion.verified_at", () => {
    it("verified_at = max captured_at across evidence", () => {
      const assertion = AssertionBuilder.build({
        rule: mockRule(),
        evidence: [robotsEvidence, httpEvidence, openApiEvidence],
        status: "VERIFIED",
        confidence: 0.9,
        reason: "All found",
      });
      // openApiEvidence has latest: 2026-01-15T11:00:00Z
      expect(assertion.verified_at).toBe("2026-01-15T11:00:00Z");
    });

    it("verified_at = timestamp fallback when no evidence (GAP)", () => {
      const assertion = AssertionBuilder.build({
        rule: mockRule(),
        evidence: [],
        status: "GAP",
        confidence: 0,
        reason: "No evidence found",
      });
      expect(assertion.verified_at).toBe(assertion.timestamp);
    });

    it("verified_at = timestamp fallback when NOT_APPLICABLE", () => {
      const assertion = AssertionBuilder.build({
        rule: mockRule(),
        evidence: [],
        status: "NOT_APPLICABLE",
        confidence: 0,
        reason: "Not applicable",
      });
      expect(assertion.verified_at).toBe(assertion.timestamp);
    });

    it("verified_at = single evidence captured_at", () => {
      const assertion = AssertionBuilder.build({
        rule: mockRule(),
        evidence: [robotsEvidence],
        status: "VERIFIED",
        confidence: 0.9,
        reason: "Found",
      });
      expect(assertion.verified_at).toBe("2026-01-15T09:00:00Z");
    });
  });

  // ─── Legacy Deserialize ─────────────────────────────────────────────────────

  describe("Legacy deserialize (no claim/verified_at)", () => {
    it("deserializes legacy assertion with claim fallback to name", () => {
      const legacy = {
        rule_id: "AB-001",
        rule_version: "1.0.0",
        status: "VERIFIED",
        evidence: [],
        confidence: 0.9,
        timestamp: "2026-01-01T00:00:00Z",
        source_url: null,
        reason: "Found",
        category: "discovery",
        name: "Robots.txt File",
      };
      const assertion = AssertionBuilder.deserialize(JSON.stringify(legacy));
      expect(assertion.claim).toBe("Robots.txt File");
    });

    it("deserializes legacy assertion with verified_at fallback to timestamp", () => {
      const legacy = {
        rule_id: "AB-001",
        rule_version: "1.0.0",
        status: "VERIFIED",
        evidence: [],
        confidence: 0.9,
        timestamp: "2026-01-01T00:00:00Z",
        source_url: null,
        reason: "Found",
        category: "discovery",
        name: "Robots.txt File",
      };
      const assertion = AssertionBuilder.deserialize(JSON.stringify(legacy));
      expect(assertion.verified_at).toBe("2026-01-01T00:00:00Z");
    });

    it("deserializes legacy assertion without crash", () => {
      const legacy = {
        rule_id: "AB-001",
        rule_version: "1.0.0",
        status: "GAP",
        evidence: [],
        confidence: 0,
        timestamp: "2026-01-01T00:00:00Z",
        source_url: null,
        reason: "No evidence",
        category: "discovery",
        name: "Test",
      };
      expect(() => AssertionBuilder.deserialize(JSON.stringify(legacy))).not.toThrow();
    });

    it("preserves claim and verified_at when present in JSON", () => {
      const json = {
        rule_id: "AB-001",
        rule_version: "1.0.0",
        status: "VERIFIED",
        evidence: [],
        confidence: 0.9,
        timestamp: "2026-01-01T00:00:00Z",
        source_url: null,
        reason: "Found",
        category: "discovery",
        name: "Test",
        claim: "Custom claim",
        verified_at: "2026-02-01T00:00:00Z",
      };
      const assertion = AssertionBuilder.deserialize(JSON.stringify(json));
      expect(assertion.claim).toBe("Custom claim");
      expect(assertion.verified_at).toBe("2026-02-01T00:00:00Z");
    });
  });

  // ─── Cross evidence captured_at ─────────────────────────────────────────────

  describe("Cross evidence captured_at", () => {
    it("cross evidence captured_at = max of member sources", () => {
      const cross: Evidence = {
        type: "cross",
        sources: [robotsEvidence, openApiEvidence],
        match_keys: ["path"],
        conflict_reason: "",
        captured_at: "2026-01-15T11:00:00Z",
      } as Evidence;
      expect(cross.captured_at).toBe("2026-01-15T11:00:00Z");
    });
  });
});
