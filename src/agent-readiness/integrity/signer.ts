import { sign, createPrivateKey } from "node:crypto";
import type { SigningKey } from "./key-manager";
import type { AgentReadinessReport } from "./report-serializer";

/**
 * Sign the content hash with an Ed25519 private key.
 * Returns base64-encoded signature for integrity.signature.value.
 */
export function signContentHash(contentHash: string, key: SigningKey): string {
  const hashBytes = Buffer.from(contentHash, "hex");

  // Reconstruct DER-encoded PKCS8 private key from raw 32 bytes
  // Ed25519 PKCS8 prefix is 16 bytes, then the 32-byte raw key
  const pkcs8Prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const derKey = Buffer.concat([pkcs8Prefix, Buffer.from(key.privateKey)]);
  const privateKeyObj = createPrivateKey({
    key: derKey,
    format: "der",
    type: "pkcs8",
  });

  const signature = sign(null, hashBytes, privateKeyObj);
  return signature.toString("base64");
}

/**
 * Populate the integrity.signature.value field on an assembled report.
 */
export function signReport(
  report: AgentReadinessReport,
  key: SigningKey,
): AgentReadinessReport {
  const signatureValue = signContentHash(report.integrity.content_hash, key);
  return {
    ...report,
    integrity: {
      ...report.integrity,
      signature: {
        ...report.integrity.signature,
        key_id: key.keyId,
        value: signatureValue,
      },
    },
  };
}
