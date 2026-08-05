import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

export function createAssertion(
  ruleId: string,
  status: Assertion["status"],
  category: string,
  severity: string = "medium",
): Assertion & { category: string; severity: string } {
  return {
    rule_id: ruleId,
    rule_version: "1.0.0",
    status,
    evidence: [],
    confidence: 0.9,
    timestamp: "2026-01-15T10:30:00Z",
    reason: "fixture",
    source_url: null,
    category,
    severity,
  } as any;
}

export const allVerified: (Assertion & { category: string; severity: string })[] = [
  createAssertion("AB-001", "VERIFIED", "discovery", "low"),
  createAssertion("AB-002", "VERIFIED", "discovery", "medium"),
  createAssertion("AB-003", "VERIFIED", "discovery", "high"),
  createAssertion("AB-004", "VERIFIED", "documentation", "high"),
  createAssertion("AB-005", "VERIFIED", "documentation", "medium"),
  createAssertion("AB-006", "VERIFIED", "actionability", "medium"),
  createAssertion("AB-007", "VERIFIED", "actionability", "high"),
  createAssertion("AB-008", "VERIFIED", "actionability", "low"),
  createAssertion("AB-009", "VERIFIED", "machine_readable", "medium"),
  createAssertion("AB-010", "VERIFIED", "machine_readable", "medium"),
  createAssertion("AB-011", "VERIFIED", "verification", "high"),
  createAssertion("AB-012", "VERIFIED", "verification", "medium"),
  createAssertion("AB-013", "VERIFIED", "verification", "low"),
];

export const allMissing: (Assertion & { category: string; severity: string })[] = [
  createAssertion("AB-001", "MISSING", "discovery", "low"),
  createAssertion("AB-002", "MISSING", "discovery", "medium"),
  createAssertion("AB-003", "MISSING", "discovery", "high"),
  createAssertion("AB-004", "MISSING", "documentation", "high"),
  createAssertion("AB-005", "MISSING", "documentation", "medium"),
  createAssertion("AB-006", "MISSING", "actionability", "medium"),
  createAssertion("AB-007", "MISSING", "actionability", "high"),
  createAssertion("AB-008", "MISSING", "actionability", "low"),
  createAssertion("AB-009", "MISSING", "machine_readable", "medium"),
  createAssertion("AB-010", "MISSING", "machine_readable", "medium"),
  createAssertion("AB-011", "MISSING", "verification", "high"),
  createAssertion("AB-012", "MISSING", "verification", "medium"),
  createAssertion("AB-013", "MISSING", "verification", "low"),
];

export const floorTriggered: (Assertion & { category: string; severity: string })[] = [
  createAssertion("AB-001", "VERIFIED", "discovery", "low"),
  createAssertion("AB-002", "VERIFIED", "discovery", "medium"),
  createAssertion("AB-003", "MISSING", "discovery", "high"),
  createAssertion("AB-004", "VERIFIED", "documentation", "high"),
  createAssertion("AB-005", "VERIFIED", "documentation", "medium"),
  createAssertion("AB-006", "VERIFIED", "actionability", "medium"),
  createAssertion("AB-007", "VERIFIED", "actionability", "high"),
  createAssertion("AB-008", "VERIFIED", "actionability", "low"),
  createAssertion("AB-009", "VERIFIED", "machine_readable", "medium"),
  createAssertion("AB-010", "VERIFIED", "machine_readable", "medium"),
  createAssertion("AB-011", "VERIFIED", "verification", "high"),
  createAssertion("AB-012", "VERIFIED", "verification", "medium"),
  createAssertion("AB-013", "VERIFIED", "verification", "low"),
];

export const mixedStatus: (Assertion & { category: string; severity: string })[] = [
  createAssertion("AB-001", "VERIFIED", "discovery", "low"),
  createAssertion("AB-002", "INFERRED", "discovery", "medium"),
  createAssertion("AB-003", "VERIFIED", "discovery", "high"),
  createAssertion("AB-004", "INFERRED", "documentation", "high"),
  createAssertion("AB-005", "VERIFIED", "documentation", "medium"),
  createAssertion("AB-006", "VERIFIED", "actionability", "medium"),
  createAssertion("AB-007", "CONFLICT", "actionability", "high"),
  createAssertion("AB-008", "VERIFIED", "actionability", "low"),
  createAssertion("AB-009", "VERIFIED", "machine_readable", "medium"),
  createAssertion("AB-010", "MISSING", "machine_readable", "medium"),
  createAssertion("AB-011", "VERIFIED", "verification", "high"),
  createAssertion("AB-012", "VERIFIED", "verification", "medium"),
  createAssertion("AB-013", "NOT_APPLICABLE", "verification", "low"),
];

export const deltaPrevious: (Assertion & { category: string; severity: string })[] = [
  createAssertion("AB-001", "MISSING", "discovery", "low"),
  createAssertion("AB-002", "VERIFIED", "discovery", "medium"),
  createAssertion("AB-003", "VERIFIED", "discovery", "high"),
  createAssertion("AB-004", "VERIFIED", "documentation", "high"),
  createAssertion("AB-005", "VERIFIED", "documentation", "medium"),
  createAssertion("AB-006", "VERIFIED", "actionability", "medium"),
  createAssertion("AB-007", "VERIFIED", "actionability", "high"),
  createAssertion("AB-008", "VERIFIED", "actionability", "low"),
  createAssertion("AB-009", "INFERRED", "machine_readable", "medium"),
  createAssertion("AB-010", "VERIFIED", "machine_readable", "medium"),
  createAssertion("AB-011", "VERIFIED", "verification", "high"),
  createAssertion("AB-012", "VERIFIED", "verification", "medium"),
  createAssertion("AB-013", "VERIFIED", "verification", "low"),
];

export const deltaCurrent: (Assertion & { category: string; severity: string })[] = [
  createAssertion("AB-001", "VERIFIED", "discovery", "low"),
  createAssertion("AB-002", "VERIFIED", "discovery", "medium"),
  createAssertion("AB-003", "VERIFIED", "discovery", "high"),
  createAssertion("AB-004", "MISSING", "documentation", "high"),
  createAssertion("AB-005", "VERIFIED", "documentation", "medium"),
  createAssertion("AB-006", "VERIFIED", "actionability", "medium"),
  createAssertion("AB-007", "VERIFIED", "actionability", "high"),
  createAssertion("AB-008", "VERIFIED", "actionability", "low"),
  createAssertion("AB-009", "VERIFIED", "machine_readable", "medium"),
  createAssertion("AB-010", "VERIFIED", "machine_readable", "medium"),
  createAssertion("AB-011", "VERIFIED", "verification", "high"),
  createAssertion("AB-012", "VERIFIED", "verification", "medium"),
  createAssertion("AB-013", "VERIFIED", "verification", "low"),
];

export const emptyAssertions: (Assertion & { category: string; severity: string })[] = [];

export const allNotApplicable: (Assertion & { category: string; severity: string })[] = [
  createAssertion("AB-001", "NOT_APPLICABLE", "discovery", "low"),
  createAssertion("AB-002", "NOT_APPLICABLE", "discovery", "medium"),
  createAssertion("AB-003", "NOT_APPLICABLE", "discovery", "high"),
];

export const singleAssertion: (Assertion & { category: string; severity: string })[] = [
  createAssertion("AB-001", "VERIFIED", "discovery", "low"),
];
