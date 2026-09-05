/**
 * SLICE-102-6: Ed25519 signature verifier for Trust Snapshot.
 *
 * Wraps the existing verifySnapshotSignature from signer.ts,
 * adding env-based public key resolution.
 */

import { verifySnapshotSignature } from "./signer.js";

/**
 * Verify a snapshot signature against a public key.
 *
 * @param snapshotHash - The hash string that was signed (e.g. "sha256:<hex>")
 * @param signature - Base64-encoded Ed25519 signature
 * @param publicKey - Base64-encoded raw Ed25519 public key
 * @returns true if signature is valid
 */
export function verifySignature(snapshotHash: string, signature: string, publicKey: string): boolean {
  return verifySnapshotSignature(snapshotHash, signature, publicKey);
}

/**
 * Resolve the AgentBadge public key from env or options.
 * Priority: options > env var.
 */
export function resolvePublicKey(optionsPublicKey?: string): string {
  const key = optionsPublicKey ?? process.env.AGENTBADGE_SIGNING_PUBLIC_KEY;
  if (!key) {
    throw new Error("AgentBadge public key not found: set AGENTBADGE_SIGNING_PUBLIC_KEY or pass via options");
  }
  return key;
}
