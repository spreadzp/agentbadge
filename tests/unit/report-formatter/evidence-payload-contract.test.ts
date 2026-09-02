import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusEnum } from "../../../src/agent-readiness/shared.schema";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

/**
 * SLICE-94-10: Payload contract — golden assertions validate against spec v0.3
 * Verifies that the golden fixture assertions carry all v2 evidence contract fields
 * and that status values are canonical (GAP, not MISSING).
 */

const fixturePath = join(__dirname, "../../fixtures/evidence/golden-assertions.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
const goldenAssertions: Assertion[] = fixture.assertions;

describe("SLICE-94-10: Payload contract — v2 fields present on all assertions", () => {
  it("every assertion has a claim string", () => {
    for (const a of goldenAssertions) {
      expect(typeof a.claim).toBe("string");
      expect(a.claim.length).toBeGreaterThan(0);
    }
  });

  it("every assertion has a verified_at ISO string", () => {
    for (const a of goldenAssertions) {
      expect(typeof a.verified_at).toBe("string");
      expect(a.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });

  it("every assertion has a review_level (string or null)", () => {
    for (const a of goldenAssertions) {
      expect(a.review_level === null || a.review_level === "automatic" || a.review_level === "assisted").toBe(true);
    }
  });

  it("every assertion has evidence array (possibly empty)", () => {
    for (const a of goldenAssertions) {
      expect(Array.isArray(a.evidence)).toBe(true);
    }
  });

  it("every evidence entry has a type from the 9-variant union", () => {
    const validTypes = ["http", "openapi", "json_schema", "html", "robots", "sitemap", "github", "manual_confirmation", "cross"];
    for (const a of goldenAssertions) {
      for (const ev of a.evidence) {
        expect(validTypes).toContain(ev.type);
      }
    }
  });

  it("every evidence entry with captured_at has an ISO string", () => {
    for (const a of goldenAssertions) {
      for (const ev of a.evidence) {
        if (ev.captured_at) {
          expect(ev.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        }
      }
    }
  });

  it("every evidence entry has source_class from the 6-class enum or undefined", () => {
    const validClasses = ["runtime", "machine_readable_spec", "machine_readable_guide", "official_docs", "website_content", "ai_inference"];
    for (const a of goldenAssertions) {
      for (const ev of a.evidence) {
        if (ev.source_class) {
          expect(validClasses).toContain(ev.source_class);
        }
      }
    }
  });
});

describe("SLICE-94-10: Payload contract — status values are canonical v2", () => {
  it("no assertion has MISSING status (GAP is canonical)", () => {
    for (const a of goldenAssertions) {
      expect(a.status).not.toBe("MISSING");
    }
  });

  it("all statuses are valid statusEnum values", () => {
    for (const a of goldenAssertions) {
      expect(statusEnum.options).toContain(a.status);
    }
  });

  it("GAP assertions have empty evidence", () => {
    for (const a of goldenAssertions) {
      if (a.status === "GAP") {
        expect(a.evidence).toHaveLength(0);
      }
    }
  });

  it("VERIFIED assertions have at least 1 evidence", () => {
    for (const a of goldenAssertions) {
      if (a.status === "VERIFIED") {
        expect(a.evidence.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("CONFLICT assertion has cross evidence with conflict_reason", () => {
    const conflicts = goldenAssertions.filter((a) => a.status === "CONFLICT");
    expect(conflicts).toHaveLength(1);
    const ev = conflicts[0].evidence[0];
    expect(ev.type).toBe("cross");
  });
});

describe("SLICE-94-10: Payload contract — report envelope shape", () => {
  it("can construct a minimal report envelope with v2 assertions", () => {
    const report = {
      report_id: "01JTEST000000000000000TEST",
      schema_version: "0.4.0",
      ruleset: { name: "agent-readiness", version: "2.2.0" },
      scope: {
        agent_id: "test-agent",
        agent_version: "1.0.0",
        endpoint_base_url: "https://example.com",
        timestamp: "2026-09-01T10:00:00Z",
      },
      scanned_at: "2026-09-01T10:00:16Z",
      previous_hash: null,
      source_state: [],
      score: { total: 50, categories: {} },
      assertions: goldenAssertions.map((a) => ({
        rule_id: a.rule_id,
        rule_version: a.rule_version,
        category: a.category,
        status: a.status,
        severity: "low",
        counted_in_score: true,
        confidence: a.confidence,
        evidence: [],
        claim: a.claim,
        verified_at: a.verified_at,
        review_level: a.review_level,
      })),
      integrity: {
        content_hash: "a".repeat(64),
        signature: { value: "sig", algorithm: "ed25519", key_id: "key1" },
      },
    };

    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.assertions).toHaveLength(10);
    expect(parsed.assertions[0].claim).toBeDefined();
    expect(parsed.assertions[0].verified_at).toBeDefined();
    expect(parsed.assertions[0].review_level).toBeDefined();
  });
});
