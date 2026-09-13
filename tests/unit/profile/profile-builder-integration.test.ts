import { describe, it, expect } from "vitest";
import { buildProfile } from "../../../src/agent-readiness/profile/profile-builder";
import { knowledgeProfileSchema } from "../../../src/agent-readiness/profile/profile-schema";
import { makeFixtureScanReport, makeFixtureAssertions } from "./fixtures/scan-report-fixture";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";

/**
 * SLICE-101-6: Profile Builder Integration tests.
 * Verifies that buildProfile() wires all extractors + freshness + confidence correctly.
 */

function makeEvidence(url: string, detail?: string, headers?: Record<string, string>): Evidence {
  return {
    type: "http", url, status: 200, headers: headers ?? {}, content_hash: "x",
    content_type: "application/json", resolved_ip: null,
    source_class: "machine_readable_spec", semantic_detail: detail
  } as Evidence;
}

function makeFullAssertion(overrides: Partial<Assertion> & { rule_id: string; category: string; status: Assertion["status"]; evidence?: Evidence[] }): Assertion {
  return {
    rule_id: overrides.rule_id, rule_version: "2.4.0", status: overrides.status,
    evidence: overrides.evidence ?? [], confidence: overrides.confidence ?? 0.9,
    timestamp: overrides.timestamp ?? "2026-09-01T10:00:00Z", source_url: overrides.source_url ?? null,
    reason: overrides.reason ?? "ok", category: overrides.category, name: overrides.name ?? overrides.rule_id,
    claim: overrides.claim ?? "claim", verified_at: overrides.verified_at ?? "2026-09-01T10:00:00Z",
    review_level: "auto" as any,
  };
}

describe("SLICE-101-6: buildProfile integration — all sections populated", () => {
  it("produces a complete profile with all 8 sections", () => {
    const assertions: Assertion[] = [
      // Discovery
      makeFullAssertion({
        rule_id: "AB-091", category: "discovery", status: "VERIFIED", name: "API Discovery",
        evidence: [makeEvidence("https://api.example.com/.well-known/agent-card.json", JSON.stringify({ skills: ["api_call"] }))]
      }),
      // OpenAPI → capabilities
      makeFullAssertion({
        rule_id: "AB-077", category: "openapi", status: "VERIFIED",
        evidence: [{ type: "openapi", url: "https://api.example.com/openapi.json", paths: ["/api/v1/tasks"], methods: ["GET"], source_class: "machine_readable_spec" }]
      }),
      // Bot auth → auth
      makeFullAssertion({
        rule_id: "AB-060", category: "bot_auth", status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/.well-known/oauth-protected-resource")]
      }),
      // Pricing
      makeFullAssertion({
        rule_id: "AB-030", category: "payments", status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/payment", JSON.stringify({ x402: true, payment: { asset: "HBAR" } }))]
      }),
      // Rate limits
      makeFullAssertion({
        rule_id: "AB-011", category: "rate_limits", status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com", undefined, { "x-ratelimit-limit": "100" })]
      }),
      // Error semantics
      makeFullAssertion({
        rule_id: "AB-040", category: "error_semantics", status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com", "Returns 400, 401, 429, 500 on errors")]
      }),
      // Agent policy
      makeFullAssertion({
        rule_id: "AB-001", category: "agent_policy", status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/llm-policy.json", JSON.stringify({ summary: "Allowed with attribution" }))]
      }),
      // Agents.txt
      makeFullAssertion({
        rule_id: "AB-003", category: "agents_txt", status: "VERIFIED", name: "agents.txt",
        evidence: [makeEvidence("https://api.example.com/agents.txt")]
      }),
    ];

    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions,
      reportId: "INTEGRATION-TEST",
    });

    // All sections should be populated
    expect(profile.capabilities).toBeDefined();
    expect(profile.auth).toBeDefined();
    expect(profile.pricing).toBeDefined();
    expect(profile.limits).toBeDefined();
    expect(profile.errors).toBeDefined();
    expect(profile.policies).toBeDefined();

    // Capabilities: endpoints from OpenAPI, protocols include REST
    expect(profile.capabilities!.data.endpoints.length).toBeGreaterThan(0);
    expect(profile.capabilities!.data.protocols).toContain("REST");

    // Auth: oauth2 method detected
    expect(profile.auth!.data.methods.some((m) => m.type === "oauth2")).toBe(true);

    // Pricing: paid model with x402 mechanism
    expect(profile.pricing!.data.model).toBe("paid");
    expect(profile.pricing!.data.mechanism).toBe("x402");
    expect(profile.pricing!.data.asset).toBe("HBAR");

    // Limits: rate_limit from header
    expect(profile.limits!.data.rate_limit).toContain("100");

    // Errors: standard codes extracted
    expect(profile.errors!.data.standard_codes).toContain(400);
    expect(profile.errors!.data.standard_codes).toContain(429);

    // Policies: llm_policy + agents_txt
    expect(profile.policies!.data.llm_policy).toBe("Allowed with attribution");
    expect(profile.policies!.data.agents_txt).toBe(true);
  });

  it("freshness section computed from populated sections", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "FRESH-TEST",
    });

    expect(profile.freshness.profile_generated_at).toBeDefined();
    expect(profile.freshness.oldest_evidence_days).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(profile.freshness.stale_sections)).toBe(true);
  });

  it("evidence_summary uses confidence aggregator (VERIFIED + INFERRED only)", () => {
    const assertions: Assertion[] = [
      makeFullAssertion({ rule_id: "AB-001", category: "discovery", status: "VERIFIED", confidence: 0.9 }),
      makeFullAssertion({ rule_id: "AB-002", category: "discovery", status: "INFERRED", confidence: 0.7 }),
      makeFullAssertion({ rule_id: "AB-003", category: "discovery", status: "GAP", confidence: 0 }),
    ];

    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions,
      reportId: "CONF-TEST",
    });

    // Only VERIFIED (0.9) and INFERRED (0.7) contribute
    expect(profile.evidence_summary.confidence_range.min).toBe(0.7);
    expect(profile.evidence_summary.confidence_range.max).toBe(0.9);
  });

  it("sections with no applicable assertions are undefined", () => {
    const assertions: Assertion[] = [
      makeFullAssertion({ rule_id: "AB-001", category: "discovery", status: "VERIFIED" }),
    ];

    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions,
      reportId: "SPARSE-TEST",
    });

    // Only capabilities should be populated (discovery maps to capabilities)
    expect(profile.capabilities).toBeDefined();
    // Others should be undefined
    expect(profile.auth).toBeUndefined();
    expect(profile.pricing).toBeUndefined();
    expect(profile.limits).toBeUndefined();
    expect(profile.errors).toBeUndefined();
    expect(profile.policies).toBeUndefined();
  });

  it("stale_sections populated when evidence is old", () => {
    const oldDate = "2020-01-01T10:00:00Z"; // Very old
    const assertions: Assertion[] = [
      makeFullAssertion({
        rule_id: "AB-077", category: "openapi", status: "VERIFIED",
        verified_at: oldDate, timestamp: oldDate,
        evidence: [{ type: "openapi", url: "https://api.example.com/openapi.json", paths: ["/api"], methods: ["GET"], source_class: "machine_readable_spec" }]
      }),
    ];

    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions,
      reportId: "STALE-TEST",
    });

    // capabilities section should be stale
    expect(profile.freshness.stale_sections).toContain("capabilities");
  });

  it("profile validates against knowledgeProfileSchema", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "SCHEMA-TEST",
    });
    // Should not throw
    expect(() => knowledgeProfileSchema.parse(profile)).not.toThrow();
  });
});
