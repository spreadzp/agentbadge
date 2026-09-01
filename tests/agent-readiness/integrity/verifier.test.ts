import { describe, it, expect } from "vitest";
import { verifyReport } from "../../../src/agent-readiness/integrity/verifier";
import { generateSigningKey } from "../../../src/agent-readiness/integrity/key-manager";
import { assembleReport } from "../../../src/agent-readiness/integrity/report-serializer";
import { signReport } from "../../../src/agent-readiness/integrity/signer";

const mockScoreResult = {
  total: { score: 85 },
  categories: { discovery: { score: 90 }, documentation: { score: 80 } },
  delta: { totalDelta: 5 },
};

const mockScope = {
  agent_id: "test-agent",
  agent_version: "1.0.0",
  endpoint_base_url: "https://api.example.com",
};

const mockAssertions = [
  { rule_id: "AB-001", status: "VERIFIED" },
  { rule_id: "AB-002", status: "GAP" },
];

function createSignedReport() {
  const key = generateSigningKey("test-verify-key");
  const report = assembleReport({
    scope: mockScope,
    assertions: mockAssertions,
    scoreResult: mockScoreResult,
    previousHash: null,
    keyId: key.keyId,
  });
  const signed = signReport(report, key);
  return { signed, key };
}

describe("SLICE-36-8: Report Verifier — Offline Integrity Check", () => {
  it("valid signed report + correct public key → verified: true", () => {
    const { signed, key } = createSignedReport();
    const result = verifyReport(JSON.stringify(signed), key.publicKey);
    expect(result.verified).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("tampered assertion → verified: false, reason: hash_mismatch", () => {
    const { signed, key } = createSignedReport();
    const tampered = { ...signed, assertions: [{ rule_id: "AB-001", status: "GAP" }] };
    const result = verifyReport(JSON.stringify(tampered), key.publicKey);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("wrong public key → verified: false, reason: invalid_signature", () => {
    const { signed } = createSignedReport();
    const wrongKey = generateSigningKey("wrong-key");
    const result = verifyReport(JSON.stringify(signed), wrongKey.publicKey);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("invalid_signature");
  });

  it("malformed JSON → verified: false, reason: malformed_report", () => {
    const { key } = createSignedReport();
    const result = verifyReport("{ invalid json }", key.publicKey);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("malformed_report");
  });

  it("all checks have name and passed fields", () => {
    const { signed, key } = createSignedReport();
    const result = verifyReport(JSON.stringify(signed), key.publicKey);
    expect(result.verified).toBe(true);
    for (const check of result.checks) {
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("passed");
    }
  });

  it("function is synchronous (no async, no promises)", () => {
    const { signed, key } = createSignedReport();
    const result = verifyReport(JSON.stringify(signed), key.publicKey);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("missing integrity block → malformed_report", () => {
    const { signed, key } = createSignedReport();
    const { integrity, ...withoutIntegrity } = signed;
    const result = verifyReport(JSON.stringify(withoutIntegrity), key.publicKey);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("malformed_report");
  });

  it("tampered score → hash_mismatch", () => {
    const { signed, key } = createSignedReport();
    const tampered = {
      ...signed,
      score: { ...signed.score, overall: 99 },
    };
    const result = verifyReport(JSON.stringify(tampered), key.publicKey);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("tampered content_hash → hash_mismatch", () => {
    const { signed, key } = createSignedReport();
    const tampered = {
      ...signed,
      integrity: {
        ...signed.integrity,
        content_hash: "a".repeat(64),
      },
    };
    const result = verifyReport(JSON.stringify(tampered), key.publicKey);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("checks array contains canonicalization, content_hash, and signature", () => {
    const { signed, key } = createSignedReport();
    const result = verifyReport(JSON.stringify(signed), key.publicKey);
    expect(result.verified).toBe(true);
    const names = result.checks.map((c) => c.name);
    expect(names).toContain("canonicalization");
    expect(names).toContain("content_hash");
    expect(names).toContain("signature");
  });
});
