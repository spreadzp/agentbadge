import { describe, it, expect } from "vitest";
import { VerificationPanel } from "../../src/views/marketplace-fragment";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

function makeTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: "task-456",
    title: "Medical Analysis",
    description: "Glucose analysis",
    status: "delivered",
    priceHbar: 50,
    capabilities: ["medical-analysis"],
    posterDid: "did:hcs:0.0.1001:1",
    claimerDid: "did:hcs:0.0.1002:2",
    createdAt: Date.now() / 1000,
    txId: "0.0.1001@1700000000.000000000",
    ...overrides,
  } as CachedMarketTask;
}

describe("VerificationPanel", () => {
  it("returns empty when no verification data", () => {
    const task = makeTask({ status: "posted", verificationAttempts: 0, verifierType: "noop" });
    const result = VerificationPanel(task).toString();
    expect(result).toBe("");
  });

  it("renders with passed status when task completed", () => {
    const task = makeTask({
      status: "completed",
      verificationAttempts: 1,
      verifierType: "datahub",
    });
    const result = VerificationPanel(task).toString();
    expect(result).toContain("DataHub Verification");
    expect(result).toContain("passed");
  });

  it("renders with retrying status when delivered and attempts < 3", () => {
    const task = makeTask({
      status: "delivered",
      verificationAttempts: 2,
      verifierType: "datahub",
    });
    const result = VerificationPanel(task).toString();
    expect(result).toContain("retrying");
    expect(result).toContain("2/3");
  });

  it("renders with failed status when delivered and attempts >= 3", () => {
    const task = makeTask({
      status: "delivered",
      verificationAttempts: 3,
      verifierType: "datahub",
    });
    const result = VerificationPanel(task).toString();
    expect(result).toContain("failed");
  });

  it("shows attempt count", () => {
    const task = makeTask({
      status: "delivered",
      verificationAttempts: 2,
      verifierType: "datahub",
    });
    const result = VerificationPanel(task).toString();
    expect(result).toContain("Attempts:");
    expect(result).toContain("2/3");
  });

  it("shows verifier type", () => {
    const task = makeTask({
      status: "delivered",
      verificationAttempts: 1,
      verifierType: "datahub",
    });
    const result = VerificationPanel(task).toString();
    expect(result).toContain("Verifier:");
    expect(result).toContain("datahub");
  });

  it("parses JSON report with assertions", () => {
    const report = JSON.stringify({
      assertions: [
        { name: "mean_glucose", passed: true },
        { name: "correlation_check", passed: false, detail: "r=0.2 < 0.3" },
      ],
    });
    const task = makeTask({
      status: "delivered",
      verificationAttempts: 1,
      verifierType: "datahub",
      verificationReport: report,
    });
    const result = VerificationPanel(task).toString();
    expect(result).toContain("mean_glucose");
    expect(result).toContain("✓");
    expect(result).toContain("correlation_check");
    expect(result).toContain("✗");
    expect(result).toContain("r=0.2");
  });

  it("parses JSON report with glossary terms", () => {
    const report = JSON.stringify({
      termsFound: ["hyperglycemia", "BMI"],
      termsMissing: ["hypoglycemia"],
    });
    const task = makeTask({
      status: "delivered",
      verificationAttempts: 1,
      verifierType: "datahub",
      verificationReport: report,
    });
    const result = VerificationPanel(task).toString();
    expect(result).toContain("Glossary Terms");
    expect(result).toContain("hyperglycemia");
    expect(result).toContain("hypoglycemia");
  });

  it("shows plain text report when not JSON", () => {
    const task = makeTask({
      status: "delivered",
      verificationAttempts: 1,
      verifierType: "datahub",
      verificationReport: "All checks passed. Mean glucose in range.",
    });
    const result = VerificationPanel(task).toString();
    expect(result).toContain("All checks passed");
  });
});
