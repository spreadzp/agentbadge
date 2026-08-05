import { describe, it, expect } from "vitest";
import { verify as cryptoVerify, createPublicKey } from "node:crypto";
import { signContentHash, signReport } from "../../../src/agent-readiness/integrity/signer";
import { generateSigningKey } from "../../../src/agent-readiness/integrity/key-manager";
import { assembleReport } from "../../../src/agent-readiness/integrity/report-serializer";

const mockScoreResult = {
  total: { score: 85 },
  categories: { discovery: { score: 90 } },
  delta: null,
};

const mockScope = {
  agent_id: "test-agent",
  agent_version: "1.0.0",
  endpoint_base_url: "https://api.example.com",
};

describe("SLICE-36-6: Ed25519 Signer", () => {
  it("signContentHash returns base64 string", () => {
    const key = generateSigningKey("test-key");
    const sig = signContentHash("a".repeat(64), key);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("different hashes produce different signatures", () => {
    const key = generateSigningKey("test-key");
    const sig1 = signContentHash("a".repeat(64), key);
    const sig2 = signContentHash("b".repeat(64), key);
    expect(sig1).not.toBe(sig2);
  });

  it("signature verifies against public key (round-trip)", () => {
    const key = generateSigningKey("test-key");
    const hash = "abcdef0123456789".repeat(4);
    const sig = signContentHash(hash, key);

    // Reconstruct DER SPKI public key from raw 32 bytes
    const spkiPrefix = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
      0x70, 0x03, 0x21, 0x00,
    ]);
    const derPub = Buffer.concat([spkiPrefix, Buffer.from(key.publicKey)]);
    const pubKeyObj = createPublicKey({ key: derPub, format: "der", type: "spki" });

    const valid = cryptoVerify(null, Buffer.from(hash, "hex"), pubKeyObj, Buffer.from(sig, "base64"));
    expect(valid).toBe(true);
  });

  it("signReport populates signature.value", () => {
    const key = generateSigningKey("test-key");
    const report = assembleReport({
      scope: mockScope,
      assertions: [],
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: key.keyId,
    });

    const signed = signReport(report, key);
    expect(signed.integrity.signature.value).not.toBe("");
    expect(signed.integrity.signature.value).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("signReport populates signature.key_id", () => {
    const key = generateSigningKey("agentbadge-prod-2026-q3");
    const report = assembleReport({
      scope: mockScope,
      assertions: [],
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: "placeholder",
    });

    const signed = signReport(report, key);
    expect(signed.integrity.signature.key_id).toBe("agentbadge-prod-2026-q3");
  });

  it("signReport preserves all other fields", () => {
    const key = generateSigningKey("test-key");
    const report = assembleReport({
      scope: mockScope,
      assertions: [{ rule_id: "AB-001" }],
      scoreResult: mockScoreResult,
      previousHash: "prev-hash-123",
      keyId: key.keyId,
    });

    const signed = signReport(report, key);
    expect(signed.report_id).toBe(report.report_id);
    expect(signed.scanned_at).toBe(report.scanned_at);
    expect(signed.previous_hash).toBe("prev-hash-123");
    expect(signed.assertions).toEqual(report.assertions);
    expect(signed.score.overall).toBe(85);
  });

  it("signature of signed report verifies against public key", () => {
    const key = generateSigningKey("verify-test");
    const report = assembleReport({
      scope: mockScope,
      assertions: [{ rule_id: "AB-001", status: "VERIFIED" }],
      scoreResult: mockScoreResult,
      previousHash: null,
      keyId: key.keyId,
    });

    const signed = signReport(report, key);

    const spkiPrefix = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
      0x70, 0x03, 0x21, 0x00,
    ]);
    const derPub = Buffer.concat([spkiPrefix, Buffer.from(key.publicKey)]);
    const pubKeyObj = createPublicKey({ key: derPub, format: "der", type: "spki" });

    const valid = cryptoVerify(
      null,
      Buffer.from(signed.integrity.content_hash, "hex"),
      pubKeyObj,
      Buffer.from(signed.integrity.signature.value, "base64"),
    );
    expect(valid).toBe(true);
  });
});
