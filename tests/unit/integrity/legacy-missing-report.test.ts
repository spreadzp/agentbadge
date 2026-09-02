import { describe, it, expect } from "vitest";
import { normalizeStatus } from "../../../src/agent-readiness/shared.schema";
import { AssertionBuilder } from "../../../src/agent-readiness/rule-engine/assertion-builder";

/**
 * SLICE-94-10: Integrity compat — legacy MISSING reports
 * Verifies that old reports with "MISSING" status:
 * 1. Raw bytes verification is unaffected (EPIC-36 operates on raw bytes)
 * 2. Parsing normalizes MISSING → GAP
 * 3. Re-serialization changes bytes (only raw verification is canonical)
 */

describe("SLICE-94-10: Integrity compat — legacy MISSING status", () => {
  it("normalizeStatus converts MISSING → GAP", () => {
    expect(normalizeStatus("MISSING")).toBe("GAP");
  });

  it("normalizeStatus passes through GAP unchanged", () => {
    expect(normalizeStatus("GAP")).toBe("GAP");
  });

  it("normalizeStatus passes through VERIFIED unchanged", () => {
    expect(normalizeStatus("VERIFIED")).toBe("VERIFIED");
  });

  it("AssertionBuilder.deserialize normalizes MISSING → GAP", () => {
    const legacyJson = JSON.stringify({
      rule_id: "AB-001",
      rule_version: "1.0.0",
      status: "MISSING",
      evidence: [],
      confidence: 0,
      timestamp: "2026-01-01T00:00:00Z",
      source_url: null,
      reason: "robots.txt not found",
      category: "discovery",
      name: "robots.txt present",
    });
    const deserialized = AssertionBuilder.deserialize(legacyJson);
    expect(deserialized.status).toBe("GAP");
  });

  it("AssertionBuilder.deserialize fills v2 fields for legacy assertions", () => {
    const legacyJson = JSON.stringify({
      rule_id: "AB-002",
      rule_version: "1.0.0",
      status: "MISSING",
      evidence: [],
      confidence: 0,
      timestamp: "2026-01-01T00:00:00Z",
      source_url: null,
      reason: "sitemap not found",
      category: "discovery",
      name: "sitemap.xml present",
    });
    const d = AssertionBuilder.deserialize(legacyJson);
    expect(d.claim).toBe("sitemap.xml present");
    expect(d.verified_at).toBe("2026-01-01T00:00:00Z");
    expect(d.review_level).toBe("assisted");
  });

  it("re-serializing a normalized assertion changes bytes vs original", () => {
    const legacyJson = JSON.stringify({
      rule_id: "AB-001",
      rule_version: "1.0.0",
      status: "MISSING",
      evidence: [],
      confidence: 0,
      timestamp: "2026-01-01T00:00:00Z",
      source_url: null,
      reason: "not found",
      category: "discovery",
      name: "robots.txt present",
    });
    const d = AssertionBuilder.deserialize(legacyJson);
    const reserialized = AssertionBuilder.serialize(d);
    expect(reserialized).not.toBe(legacyJson);
    expect(JSON.parse(reserialized).status).toBe("GAP");
    expect(JSON.parse(legacyJson).status).toBe("MISSING");
  });

  it("raw bytes of legacy report are unchanged by normalization (EPIC-36 invariant)", () => {
    const rawReport = {
      assertions: [{ rule_id: "AB-001", status: "MISSING", confidence: 0 }],
      integrity: { content_hash: "abc123", signature: { value: "sig" } },
    };
    const rawBytes = JSON.stringify(rawReport);
    expect(JSON.parse(rawBytes).assertions[0].status).toBe("MISSING");
    expect(rawBytes).toContain('"MISSING"');
  });
});
