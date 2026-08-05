import { describe, it, expect } from "vitest";
import { assembleReport } from "../../../src/agent-readiness/integrity/report-serializer";

const mockScoreResult = {
  total: { score: 85 },
  categories: {
    discovery: { score: 90 },
    documentation: { score: 80 },
    actionability: { score: 85 },
    machine_readable: { score: 88 },
    verification: { score: 82 },
  },
  delta: { totalDelta: 5 },
};

const mockScope = {
  agent_id: "test-agent",
  agent_version: "1.0.0",
  endpoint_base_url: "https://api.example.com",
};

const mockAssertions = [
  { rule_id: "AB-001", status: "VERIFIED" },
  { rule_id: "AB-002", status: "MISSING" },
];

describe("SLICE-36-5: Report Serializer", () => {
  it("produces a valid ULID report_id", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.report_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("content_hash is 64-char hex", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.integrity.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("previous_hash is null when not provided", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.previous_hash).toBeNull();
  });

  it("previous_hash is included when provided", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: "abc123def456",
      keyId: "test-key-1",
    });
    expect(report.previous_hash).toBe("abc123def456");
  });

  it("score.overall matches input", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.score.overall).toBe(85);
  });

  it("score.categories match input", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.score.categories.discovery).toBe(90);
    expect(report.score.categories.documentation).toBe(80);
  });

  it("score.delta matches input", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.score.delta).toBe(5);
  });

  it("assertions passed through unchanged", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.assertions).toEqual(mockAssertions);
  });

  it("integrity.signature.value is empty (populated by signer)", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.integrity.signature.value).toBe("");
  });

  it("integrity.signature.key_id matches input", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "agentbadge-prod-2026-q3",
    });
    expect(report.integrity.signature.key_id).toBe("agentbadge-prod-2026-q3");
  });

  it("schema_version is 0.1.0", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.schema_version).toBe("0.1.0");
  });

  it("scanned_at is ISO 8601", () => {
    const report = assembleReport({
      scope: mockScope,
      assertions: mockAssertions,
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "test-key-1",
    });
    expect(report.scanned_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
