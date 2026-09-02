import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

/**
 * SLICE-94-1: Spec v0.3 — Evidence Contract V2
 *
 * Tests that the report JSON schema:
 * 1. Accepts a V2 assertion (GAP status + claim + verified_at + review_level + evidence with captured_at/source_class)
 * 2. Accepts a LEGACY assertion (MISSING status, no v2 fields) — input compat
 * 3. Rejects an invalid status (not in enum)
 * 4. Accepts GAP as a valid status value
 */

const schemaPath = resolve(
  __dirname,
  "../../../docs/EPICS/32-agent-readiness-spec/spec/schemas/agentbadge-report.schema.json",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

/** Minimal valid report skeleton — fill in assertions per test */
function baseReport(assertions: unknown[]) {
  return {
    report_id: "01H8XGJY6K1MNPQRSTVWXYZAB0",
    schema_version: "0.1.0",
    ruleset: { name: "agent-readiness", version: "1.2.0" },
    scope: {
      agent_id: "https://example.com",
      agent_version: "1.0.0",
      endpoint_base_url: "https://example.com",
      timestamp: "2026-08-31T09:20:00Z",
    },
    scanned_at: "2026-08-31T09:20:00Z",
    previous_hash: null,
    source_state: [],
    score: { total: 50, categories: { discovery: 50, documentation: 50, actionability: 50, machine_readable: 50, verification: 50 } },
    assertions,
    integrity: {
      algorithm: "sha256",
      canonicalization: "JCS-RFC8785",
      content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      signature: {
        algorithm: "ed25519",
        key_id: "test-key-1",
        value: "base64-signature",
      },
    },
  };
}

describe("SLICE-94-1: agentbadge-report.schema.json — Evidence Contract V2", () => {
  it("accepts a V2 assertion with GAP status + new fields", () => {
    const v2Assertion = {
      rule_id: "AB-030",
      rule_version: "1.0.0",
      category: "discovery",
      status: "GAP",
      severity: "high",
      counted_in_score: true,
      confidence: 0.0,
      claim: "Pricing is machine-readable and discoverable by agents",
      verified_at: "2026-08-31T09:20:00Z",
      review_level: "assisted",
      age_days: 0,
      stale: false,
      evidence: [
        {
          type: "http",
          url: "https://example.com/pricing",
          status: 200,
          headers: {},
          content_hash: "abc123",
          content_type: "text/html",
          resolved_ip: null,
          captured_at: "2026-08-31T09:20:00Z",
          source_class: "website_content",
        },
      ],
    };

    const valid = validate(baseReport([v2Assertion]));
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("accepts a LEGACY assertion with MISSING status and no v2 fields", () => {
    const legacyAssertion = {
      rule_id: "AB-001",
      rule_version: "1.0.0",
      category: "discovery",
      status: "MISSING",
      severity: "low",
      counted_in_score: true,
      confidence: 0,
      evidence: [],
    };

    const valid = validate(baseReport([legacyAssertion]));
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("accepts GAP as a valid status value", () => {
    const gapAssertion = {
      rule_id: "AB-002",
      rule_version: "1.0.0",
      category: "discovery",
      status: "GAP",
      severity: "medium",
      counted_in_score: true,
      confidence: 0.3,
      evidence: [],
    };

    const valid = validate(baseReport([gapAssertion]));
    expect(valid).toBe(true);
  });

  it("rejects an invalid status value", () => {
    const badAssertion = {
      rule_id: "AB-003",
      rule_version: "1.0.0",
      category: "discovery",
      status: "UNKNOWN",
      severity: "low",
      counted_in_score: true,
      confidence: 0,
      evidence: [],
    };

    const valid = validate(baseReport([badAssertion]));
    expect(valid).toBe(false);
  });

  it("accepts evidence with captured_at and source_class fields", () => {
    const assertion = {
      rule_id: "AB-004",
      rule_version: "1.0.0",
      category: "discovery",
      status: "VERIFIED",
      severity: "low",
      counted_in_score: true,
      confidence: 0.95,
      evidence: [
        {
          type: "openapi",
          url: "https://example.com/openapi.json",
          paths: ["/api"],
          methods: ["GET"],
          captured_at: "2026-08-31T09:20:00Z",
          source_class: "machine_readable_spec",
        },
      ],
    };

    const valid = validate(baseReport([assertion]));
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("accepts review_level null for NOT_APPLICABLE", () => {
    const assertion = {
      rule_id: "AB-005",
      rule_version: "1.0.0",
      category: "discovery",
      status: "NOT_APPLICABLE",
      severity: "low",
      counted_in_score: false,
      confidence: 0,
      review_level: null,
      evidence: [],
    };

    const valid = validate(baseReport([assertion]));
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });

  it("accepts review_level 'automatic' for high-confidence VERIFIED", () => {
    const assertion = {
      rule_id: "AB-006",
      rule_version: "1.0.0",
      category: "discovery",
      status: "VERIFIED",
      severity: "low",
      counted_in_score: true,
      confidence: 0.95,
      review_level: "automatic",
      evidence: [
        {
          type: "http",
          url: "https://example.com/robots.txt",
          status: 200,
          headers: {},
          content_hash: "def456",
          content_type: "text/plain",
          resolved_ip: null,
          captured_at: "2026-08-31T09:20:00Z",
          source_class: "machine_readable_guide",
        },
      ],
    };

    const valid = validate(baseReport([assertion]));
    if (!valid) {
      console.error("Validation errors:", validate.errors);
    }
    expect(valid).toBe(true);
  });
});
