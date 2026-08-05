import { verify as cryptoVerify, createHash, createPublicKey } from "node:crypto";
import { canonicalizeJson } from "./jcs";
import type { AgentReadinessReport } from "./report-serializer";

export type VerifyResult =
  | { verified: true; checks: VerifyCheck[] }
  | { verified: false; reason: VerifyFailureReason; checks: VerifyCheck[] };

export type VerifyFailureReason =
  | "hash_mismatch"
  | "invalid_signature"
  | "unknown_key"
  | "malformed_report";

export interface VerifyCheck {
  name: "canonicalization" | "content_hash" | "signature";
  passed: boolean;
  detail?: string;
}

export function verifyReport(
  reportJson: string,
  publicKey: Uint8Array,
): VerifyResult {
  const checks: VerifyCheck[] = [];

  let report: AgentReadinessReport;
  try {
    report = JSON.parse(reportJson);
  } catch {
    return {
      verified: false,
      reason: "malformed_report",
      checks: [{ name: "canonicalization", passed: false, detail: "JSON parse failed" }],
    };
  }

  if (!report.integrity || !report.integrity.content_hash || !report.integrity.signature) {
    return {
      verified: false,
      reason: "malformed_report",
      checks: [{ name: "canonicalization", passed: false, detail: "Missing integrity block" }],
    };
  }

  const { integrity, ...body } = report;
  const canonical = canonicalizeJson(body);
  checks.push({ name: "canonicalization", passed: true });

  const recomputedHash = createHash("sha256").update(canonical, "utf8").digest("hex");
  const hashMatches = recomputedHash === integrity.content_hash;
  checks.push({
    name: "content_hash",
    passed: hashMatches,
    detail: hashMatches ? undefined : `expected ${integrity.content_hash}, got ${recomputedHash}`,
  });

  if (!hashMatches) {
    return { verified: false, reason: "hash_mismatch", checks };
  }

  const hashBytes = Buffer.from(integrity.content_hash, "hex");
  const signatureBytes = Buffer.from(integrity.signature.value, "base64");

  const spkiPrefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
    0x70, 0x03, 0x21, 0x00,
  ]);
  const derPub = Buffer.concat([spkiPrefix, Buffer.from(publicKey)]);

  let signatureValid = false;
  try {
    const pubKeyObj = createPublicKey({ key: derPub, format: "der", type: "spki" });
    signatureValid = cryptoVerify(null, hashBytes, pubKeyObj, signatureBytes);
  } catch {
    signatureValid = false;
  }

  checks.push({
    name: "signature",
    passed: signatureValid,
    detail: signatureValid ? undefined : "Ed25519 signature verification failed",
  });

  if (!signatureValid) {
    return { verified: false, reason: "invalid_signature", checks };
  }

  return { verified: true, checks };
}
