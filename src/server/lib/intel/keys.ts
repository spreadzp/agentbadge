// EPIC-262 (SLICE-262-0a): intel signing-key resolution.
//
// The private key never lives in the repo: INTEL_SIGNING_PRIVATE_KEY is a
// base64 raw 32-byte Ed25519 seed from fly secrets / .env. The public
// half is DERIVED at boot — a mismatched env pair is impossible.
//
// No ephemeral fallback: /.well-known/agentbadge-keys.json must be stable
// across restarts, so `enabled` without a seed resolves to null and the
// routes answer 503 intel_key_missing (honest misconfig, agent-registration
// precedent) instead of silently publishing a new key per boot.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { logger } from "@agentbadge/passport/logger";
import type { IntelEnvConfig } from "../../../config/env";
import type { SigningKey } from "../../../agent-readiness/integrity/key-manager";

export const INTEL_API_VERSION = "0.1.0";

// Ed25519 PKCS8 DER prefix: 16-byte header + 32-byte raw seed
// (same construction as agent-readiness/integrity/signer.ts).
const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export function resolveIntelSigningKey(cfg: IntelEnvConfig): SigningKey | null {
  if (!cfg.signingPrivateKey) {
    logger.error(
      "INTEL_ENABLED but INTEL_SIGNING_PRIVATE_KEY is not set — " +
        "intel signing surface will answer 503 intel_key_missing",
    );
    return null;
  }
  let seed: Buffer;
  try {
    seed = Buffer.from(cfg.signingPrivateKey, "base64");
  } catch {
    logger.error("INTEL_SIGNING_PRIVATE_KEY is not valid base64");
    return null;
  }
  if (seed.length !== 32) {
    logger.error("INTEL_SIGNING_PRIVATE_KEY must decode to 32 bytes", {
      bytes: seed.length,
    });
    return null;
  }

  const privateKeyObj = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKeyObj).export({
    format: "der",
    type: "spki",
  });
  return {
    keyId: cfg.keyId,
    algorithm: "ed25519",
    privateKey: new Uint8Array(seed),
    // SPKI DER = 12-byte header + 32-byte raw public key.
    publicKey: new Uint8Array(spki.subarray(spki.length - 32)),
  };
}

export interface IntelPublicKeyEntry {
  key_id: string;
  algorithm: "ed25519";
  public_key: string; // base64 raw 32-byte public key
  use: "sig";
  status: "active";
}

export function toPublicKeyEntry(key: SigningKey): IntelPublicKeyEntry {
  return {
    key_id: key.keyId,
    algorithm: key.algorithm,
    public_key: Buffer.from(key.publicKey).toString("base64"),
    use: "sig",
    status: "active",
  };
}
