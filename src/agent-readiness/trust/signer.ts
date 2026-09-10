/**
 * SLICE-102-2: Ed25519 signer for Trust Snapshot.
 *
 * Reuses Node.js crypto module (same as report-serializer.ts).
 */

import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";

export interface SnapshotSignature {
  algorithm: "ed25519";
  public_key: string;
  signature: string;
}

/**
 * Sign a snapshot hash with an Ed25519 private key.
 *
 * @param snapshotHash - The hash string (e.g. "sha256:<hex>")
 * @param privateKeyRaw - 32-byte raw Ed25519 private key
 * @returns Signature info with algorithm, base64 public key, and base64 signature
 */
export function signSnapshot(snapshotHash: string, privateKeyRaw: Uint8Array): SnapshotSignature {
  // Extract hex bytes from "sha256:<hex>" format
  const hexPart = snapshotHash.replace(/^sha256:/, "");
  const hashBytes = Buffer.from(hexPart, "hex");

  // Reconstruct DER-encoded PKCS8 private key from raw 32 bytes
  const pkcs8Prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const derKey = Buffer.concat([pkcs8Prefix, Buffer.from(privateKeyRaw)]);
  const privateKeyObj = createPrivateKey({
    key: derKey,
    format: "der",
    type: "pkcs8",
  });

  const signatureBytes = sign(null, hashBytes, privateKeyObj);

  // Derive public key from private key
  const publicKeyObj = createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ type: "spki", format: "der" });
  // Raw Ed25519 public key is last 32 bytes of SPKI DER
  const publicKeyRaw = new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32));

  return {
    algorithm: "ed25519",
    public_key: Buffer.from(publicKeyRaw).toString("base64"),
    signature: signatureBytes.toString("base64"),
  };
}

/**
 * Verify a snapshot signature.
 *
 * @param snapshotHash - The hash string that was signed
 * @param signatureBase64 - Base64-encoded signature
 * @param publicKeyBase64 - Base64-encoded raw public key
 * @returns true if signature is valid
 */
export function verifySnapshotSignature(
  snapshotHash: string,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean {
  try {
    const hexPart = snapshotHash.replace(/^sha256:/, "");
    const hashBytes = Buffer.from(hexPart, "hex");
    const signatureBytes = Buffer.from(signatureBase64, "base64");
    const publicKeyRaw = Buffer.from(publicKeyBase64, "base64");

    // Reconstruct DER-encoded SPKI public key from raw 32 bytes
    const spkiPrefix = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
      0x03, 0x21, 0x00,
    ]);
    const derKey = Buffer.concat([spkiPrefix, publicKeyRaw]);
    const publicKeyObj = createPublicKey({
      key: derKey,
      format: "der",
      type: "spki",
    });

    return verify(null, hashBytes, publicKeyObj, signatureBytes);
  } catch {
    return false;
  }
}
