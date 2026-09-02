import { describe, it, expect } from "vitest";
import { checkThresholds } from "../../../src/agent-readiness/ci/threshold-checker";
import type { AgentReadinessReport } from "../../../src/agent-readiness/integrity/report-serializer";

function makeReport(score: number, assertions?: any[]): AgentReadinessReport {
  return {
    report_id: "01HTEST0000000000000000001",
    schema_version: "0.3.0",
    ruleset: { name: "agent-readiness", version: "1.2.0" },
    scope: {
      agent_id: "test-api",
      agent_version: "1.0",
      endpoint_base_url: "https://test.com",
      timestamp: "2025-01-15T10:00:00.000Z",
    },
    scanned_at: "2025-01-15T10:00:00.000Z",
    previous_hash: null,
    score: { overall: score, categories: {} },
    assertions: assertions ?? [],
    integrity: {
      content_hash: "a".repeat(64),
      signature: { algorithm: "ed25519", key_id: "k", value: "" },
    },
  } as unknown as AgentReadinessReport;
}

describe("SLICE-39-4: Threshold Checker", () => {
  it("passes when score >= minScore", () => {
    const result = checkThresholds(makeReport(85), 70);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.failures).toHaveLength(0);
  });

  it("passes when score equals minScore", () => {
    const result = checkThresholds(makeReport(70), 70);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("fails when score < minScore", () => {
    const result = checkThresholds(makeReport(50), 70);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].type).toBe("score");
    expect(result.failures[0].message).toContain("50");
    expect(result.failures[0].message).toContain("70");
  });

  it("passes with minScore=0 always", () => {
    const result = checkThresholds(makeReport(0), 0);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("fails on high severity unverified assertion", () => {
    const result = checkThresholds(makeReport(90, [
      { rule_id: "AB-001", status: "GAP", severity: "high" },
    ]), 0);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].type).toBe("severity");
    expect(result.failures[0].rule_id).toBe("AB-001");
  });

  it("passes on high severity verified assertion", () => {
    const result = checkThresholds(makeReport(90, [
      { rule_id: "AB-001", status: "VERIFIED", severity: "high" },
    ]), 0);
    expect(result.passed).toBe(true);
  });

  it("passes on high severity PASS assertion", () => {
    const result = checkThresholds(makeReport(90, [
      { rule_id: "AB-001", status: "PASS", severity: "high" },
    ]), 0);
    expect(result.passed).toBe(true);
  });

  it("ignores medium severity unverified", () => {
    const result = checkThresholds(makeReport(90, [
      { rule_id: "AB-001", status: "GAP", severity: "medium" },
    ]), 0);
    expect(result.passed).toBe(true);
  });

  it("ignores low severity unverified", () => {
    const result = checkThresholds(makeReport(90, [
      { rule_id: "AB-001", status: "GAP", severity: "low" },
    ]), 0);
    expect(result.passed).toBe(true);
  });

  it("fails on both score and severity", () => {
    const result = checkThresholds(makeReport(50, [
      { rule_id: "AB-001", status: "GAP", severity: "high" },
    ]), 70);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.failures).toHaveLength(2);
  });

  it("handles missing severity field", () => {
    const result = checkThresholds(makeReport(90, [
      { rule_id: "AB-001", status: "GAP" },
    ]), 0);
    expect(result.passed).toBe(true);
  });

  it("handles empty assertions", () => {
    const result = checkThresholds(makeReport(90, []), 0);
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("handles score.total fallback", () => {
    const report = makeReport(0);
    (report.score as any) = { total: 75, categories: {} };
    const result = checkThresholds(report, 70);
    expect(result.passed).toBe(true);
  });

  it("is pure function (deterministic)", () => {
    const report = makeReport(85);
    expect(checkThresholds(report, 70)).toEqual(checkThresholds(report, 70));
  });
});
