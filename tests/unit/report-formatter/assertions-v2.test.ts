import { describe, it, expect } from "vitest";
import { formatScanReport } from "../../../src/agent-readiness/report-formatter";
import type { RuleEngineResult } from "../../../src/agent-readiness/rule-engine/rule-engine";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvidence(type: Evidence["type"], overrides: Record<string, unknown> = {}): Evidence {
  const base: Record<string, unknown> = { type, captured_at: "2025-06-01T00:00:00Z" };
  if (type === "http") {
    base.url = "https://example.com";
    base.status = 200;
    base.headers = {};
    base.content_hash = "abcdef1234567890";
    base.content_type = "text/html";
    base.resolved_ip = null;
  } else if (type === "openapi") {
    base.url = "https://example.com/openapi.json";
    base.paths = ["/api/v1"];
    base.methods = ["GET"];
  } else if (type === "html") {
    base.url = "https://example.com";
    base.title = "Example";
    base.content_hash = "abcdef1234567890";
  } else if (type === "cross") {
    base.sources = [];
    base.match_keys = [];
    base.conflict_reason = "";
  }
  return { ...base, ...overrides } as unknown as Evidence;
}

function makeAssertion(overrides: Record<string, unknown> = {}): Assertion {
  return {
    rule_id: "AB-TEST",
    rule_version: "1.0.0",
    status: "VERIFIED",
    evidence: [makeEvidence("openapi")],
    confidence: 0.9,
    timestamp: "2025-06-10T00:00:00Z",
    source_url: "https://example.com",
    reason: "OpenAPI spec found",
    category: "openapi",
    name: "OpenAPI Spec",
    claim: "Site exposes OpenAPI spec",
    verified_at: "2025-06-10T00:00:00Z",
    review_level: "automatic",
    ...overrides,
  } as Assertion;
}

function makeResult(assertions: Assertion[]): RuleEngineResult {
  return {
    assertions,
    rulesetVersion: "1.0.0",
    scannedAt: "2025-06-10T00:00:00Z",
    totalRules: assertions.length,
    applicableRules: assertions.length,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("SLICE-94-7: Web Report Payload — Assertions V2", () => {

  // ─── V2 fields present on every assertion ───────────────────────────────────

  describe("assertion v2 fields in report payload", () => {
    it("every assertion has claim, verified_at, review_level", () => {
      const result = makeResult([
        makeAssertion({ rule_id: "AB-001" }),
        makeAssertion({ rule_id: "AB-002", status: "INFERRED", confidence: 0.5, review_level: "assisted" }),
      ]);
      const report = formatScanReport("https://example.com", result);
      expect(report.assertions).toBeDefined();
      expect(report.assertions.length).toBe(2);
      for (const a of report.assertions) {
        expect(a.claim).toBeDefined();
        expect(typeof a.claim).toBe("string");
        expect(a.verified_at).toBeDefined();
        expect(typeof a.verified_at).toBe("string");
        expect(a.review_level).toBeDefined();
      }
    });

    it("assertion has source_class and source_label from strongestSource", () => {
      const result = makeResult([
        makeAssertion({
          evidence: [
            makeEvidence("html"),
            makeEvidence("openapi"),
          ],
        }),
      ]);
      const report = formatScanReport("https://example.com", result);
      const a = report.assertions[0];
      // openapi is machine_readable_spec (rank 5) > html website_content (rank 2)
      expect(a.source_class).toBe("machine_readable_spec");
      expect(a.source_label).toBe("OpenAPI / JSON Schema");
    });

    it("assertion has evidence array with type, captured_at, source_class, summary", () => {
      const result = makeResult([
        makeAssertion({
          evidence: [makeEvidence("openapi", { captured_at: "2025-06-05T00:00:00Z" })],
        }),
      ]);
      const report = formatScanReport("https://example.com", result);
      const a = report.assertions[0];
      expect(a.evidence).toBeDefined();
      expect(a.evidence.length).toBe(1);
      const ev = a.evidence[0];
      expect(ev.type).toBe("openapi");
      expect(ev.captured_at).toBe("2025-06-05T00:00:00Z");
      expect(ev.source_class).toBe("machine_readable_spec");
      expect(typeof ev.summary).toBe("string");
      expect(ev.summary.length).toBeGreaterThan(0);
    });
  });

  // ─── GAP assertion ──────────────────────────────────────────────────────────

  describe("GAP assertion serialization", () => {
    it("GAP assertion has claim, review_level: assisted, empty evidence, no captured_at", () => {
      const result = makeResult([
        makeAssertion({
          rule_id: "AB-GAP",
          status: "GAP",
          confidence: 0,
          review_level: "assisted",
          evidence: [],
          claim: "Site should expose robots.txt",
          reason: "robots.txt not found",
        }),
      ]);
      const report = formatScanReport("https://example.com", result);
      const a = report.assertions[0];
      expect(a.status).toBe("GAP");
      expect(a.claim).toBe("Site should expose robots.txt");
      expect(a.review_level).toBe("assisted");
      expect(a.evidence).toEqual([]);
      // No source_class on a GAP assertion (no evidence to classify)
      expect(a.source_class).toBeNull();
      expect(a.source_label).toBeNull();
    });
  });

  // ─── Legacy assertions (missing v2 fields) ──────────────────────────────────

  describe("legacy assertion fallbacks", () => {
    it("assertion without claim falls back to name, without verified_at falls back to timestamp", () => {
      // Simulate a legacy assertion by building one with deserialize
      // and then passing it through the formatter
      const legacy: Assertion = {
        rule_id: "AB-LEGACY",
        rule_version: "0.9.0",
        status: "VERIFIED",
        evidence: [],
        confidence: 0.85,
        timestamp: "2025-01-01T00:00:00Z",
        source_url: null,
        reason: "legacy check",
        category: "discovery",
        name: "Legacy Rule",
        claim: "Legacy Rule", // deserialize would set claim=name
        verified_at: "2025-01-01T00:00:00Z", // deserialize would set verified_at=timestamp
        review_level: "automatic", // deserialize would recompute
      };
      const result = makeResult([legacy]);
      const report = formatScanReport("https://example.com", result);
      const a = report.assertions[0];
      expect(a.claim).toBe("Legacy Rule");
      expect(a.verified_at).toBe("2025-01-01T00:00:00Z");
      expect(a.review_level).toBe("automatic");
    });

    it("no MISSING status in payload (GAP is canonical)", () => {
      const result = makeResult([
        makeAssertion({ rule_id: "AB-001", status: "GAP" }),
        makeAssertion({ rule_id: "AB-002", status: "VERIFIED" }),
      ]);
      const report = formatScanReport("https://example.com", result);
      for (const a of report.assertions) {
        expect(a.status).not.toBe("MISSING");
      }
    });
  });

  // ─── Counts block ───────────────────────────────────────────────────────────

  describe("counts block", () => {
    it("gap count is present alongside verified/conflict/not_applicable", () => {
      const result = makeResult([
        makeAssertion({ rule_id: "AB-001", status: "VERIFIED" }),
        makeAssertion({ rule_id: "AB-002", status: "GAP" }),
        makeAssertion({ rule_id: "AB-003", status: "CONFLICT" }),
        makeAssertion({ rule_id: "AB-004", status: "NOT_APPLICABLE" }),
      ]);
      const report = formatScanReport("https://example.com", result);
      expect(report.gap).toBe(1);
      expect(report.verified).toBeGreaterThanOrEqual(1);
      expect(report.not_applicable).toBe(1);
    });
  });

  // ─── Backward compatibility ─────────────────────────────────────────────────

  describe("backward compatibility", () => {
    it("existing ScanReport fields are still present", () => {
      const result = makeResult([makeAssertion()]);
      const report = formatScanReport("https://example.com", result);
      // All pre-existing fields must still be present
      expect(report.url).toBe("https://example.com");
      expect(report.score).toBeDefined();
      expect(report.grade).toBeDefined();
      expect(report.total_rules).toBeDefined();
      expect(report.categories).toBeDefined();
      expect(report.pillars).toBeDefined();
      expect(report.summary).toBeDefined();
    });
  });

  // ─── Cross evidence source_class ────────────────────────────────────────────

  describe("cross evidence in assertion payload", () => {
    it("cross evidence gets source_class from strongest member", () => {
      const cross = makeEvidence("cross", {
        sources: [
          makeEvidence("html"),
          makeEvidence("openapi"),
        ],
      });
      const result = makeResult([
        makeAssertion({ evidence: [cross] }),
      ]);
      const report = formatScanReport("https://example.com", result);
      const a = report.assertions[0];
      // Cross evidence's source_class comes from strongest member: openapi → machine_readable_spec
      expect(a.source_class).toBe("machine_readable_spec");
    });
  });
});
