import type { ScanReport, CategoryReport } from "../../../../src/agent-readiness/report-formatter";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";

/**
 * SLICE-101-2: Fixture scan report + assertions for profile builder tests.
 */

export function makeFixtureScanReport(): ScanReport {
  return {
    url: "https://api.example.com",
    score: 78,
    grade: "B",
    total_rules: 40,
    verified: 32,
    missing: 6,
    gap: 6,
    not_applicable: 2,
    skipped: 0,
    categories: [
      { category: "discovery", name: "Discovery", icon: "🔍", total: 5, verified: 4, missing: 1, completeness_pct: 80 },
      { category: "documentation", name: "Documentation", icon: "📖", total: 8, verified: 7, missing: 1, completeness_pct: 87 },
      { category: "openapi", name: "OpenAPI", icon: "📋", total: 6, verified: 5, missing: 1, completeness_pct: 83 },
      { category: "bot_auth", name: "Bot Auth", icon: "🔐", total: 4, verified: 3, missing: 1, completeness_pct: 75 },
      { category: "pricing", name: "Pricing", icon: "💰", total: 3, verified: 2, missing: 1, completeness_pct: 66 },
      { category: "rate_limits", name: "Rate Limits", icon: "⏱️", total: 2, verified: 2, missing: 0, completeness_pct: 100 },
      { category: "error_semantics", name: "Error Semantics", icon: "⚠️", total: 4, verified: 3, missing: 1, completeness_pct: 75 },
      { category: "agent_policy", name: "Agent Policy", icon: "🤖", total: 3, verified: 3, missing: 0, completeness_pct: 100 },
    ] as CategoryReport[],
    top_missing: [],
    summary: "Example API with OpenAPI spec, OAuth2, and freemium pricing",
    pillars: [],
    floorTriggered: false,
    floorReason: null,
    assertions: [],
    gaps: [],
    gap_summary: { total: 6, by_priority: { CRITICAL: 0, HIGH: 2, MEDIUM: 3, LOW: 1 }, by_type: { documentation: 1, semantic: 2, capability: 2, evidence: 1 } },
  };
}

export function makeFixtureAssertions(): Assertion[] {
  const baseTimestamp = "2026-09-01T10:00:00Z";
  const olderTimestamp = "2026-08-29T10:00:00Z";

  const make = (overrides: Partial<Assertion> & { rule_id: string; category: string; status: Assertion["status"] }): Assertion => ({
    rule_id: overrides.rule_id,
    rule_version: "2.4.0",
    status: overrides.status,
    evidence: [],
    confidence: overrides.confidence ?? 0.9,
    timestamp: overrides.timestamp ?? baseTimestamp,
    source_url: overrides.source_url ?? null,
    reason: overrides.reason ?? "ok",
    category: overrides.category,
    name: overrides.name ?? overrides.rule_id,
    claim: overrides.claim ?? "claim",
    verified_at: overrides.verified_at ?? baseTimestamp,
    review_level: overrides.review_level ?? "automatic",
    fix: overrides.fix,
    severity: overrides.severity,
    display_question: overrides.display_question,
  });

  return [
    // Discovery — VERIFIED with name
    make({ rule_id: "AB-091", category: "discovery", status: "VERIFIED", name: "API Discovery", confidence: 0.95, timestamp: baseTimestamp }),
    make({ rule_id: "AB-092", category: "discovery", status: "VERIFIED", confidence: 0.9, timestamp: olderTimestamp }),
    // Documentation
    make({ rule_id: "AB-093", category: "documentation", status: "VERIFIED", confidence: 0.85 }),
    make({ rule_id: "AB-094", category: "documentation", status: "GAP", confidence: 0.0, timestamp: olderTimestamp }),
    // OpenAPI
    make({ rule_id: "AB-077", category: "openapi", status: "VERIFIED", confidence: 0.95 }),
    // Bot auth
    make({ rule_id: "AB-060", category: "bot_auth", status: "VERIFIED", confidence: 0.9 }),
    make({ rule_id: "AB-058", category: "bot_auth", status: "GAP", confidence: 0.0 }),
    // Identity
    make({ rule_id: "AB-055", category: "identity", status: "INFERRED", confidence: 0.7 }),
    // Pricing
    make({ rule_id: "AB-030", category: "pricing", status: "VERIFIED", confidence: 0.85 }),
    make({ rule_id: "AB-031", category: "payments", status: "VERIFIED", confidence: 0.8 }),
    // Rate limits
    make({ rule_id: "AB-011", category: "rate_limits", status: "VERIFIED", confidence: 0.8 }),
    // Error semantics
    make({ rule_id: "AB-040", category: "error_semantics", status: "VERIFIED", confidence: 0.9 }),
    make({ rule_id: "AB-041", category: "error_semantics", status: "CONFLICT", confidence: 0.5 }),
    // Agent policy
    make({ rule_id: "AB-001", category: "agent_policy", status: "VERIFIED", confidence: 0.95 }),
    // NOT_APPLICABLE
    make({ rule_id: "AB-200", category: "sandbox", status: "NOT_APPLICABLE", confidence: 0.0 }),
  ];
}
