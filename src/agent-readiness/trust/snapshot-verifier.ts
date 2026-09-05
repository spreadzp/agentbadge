/**
 * SLICE-102-6: Snapshot Verifier — full trust verification pipeline.
 *
 * Performs 7 verification steps:
 * 1. Structural validation (zod schema)
 * 2. Hash recomputation (canonical JSON + sha256)
 * 3. Signature verification (Ed25519)
 * 4. On-chain lookup (readOnChainAttestation)
 * 5. On-chain hash comparison
 * 6. Freshness check (timestamp within window)
 * 7. Domain ownership expiry check
 */

import { canonicalize } from "./canonical-json.js";
import { sha256Hex } from "./hashing.js";
import { trustSnapshotSchema, type TrustSnapshot } from "./trust-schema.js";
import { verifySignature, resolvePublicKey } from "./signature-verifier.js";
import { checkFreshness } from "./freshness-checker.js";
import { readOnChainAttestation } from "./verification-reader.js";

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface VerificationResult {
  valid: boolean;
  checks: VerificationCheck[];
  reason?: string;
}

export interface VerifySnapshotOptions {
  freshnessWindowDays?: number;
  agentBadgePublicKey?: string;
  contractAddress?: string;
  rpcUrl?: string;
  skipOnChain?: boolean;
}

/**
 * Verify a Trust Snapshot through all 7 checks.
 *
 * @param snapshot - The TrustSnapshot to verify
 * @param options - Optional configuration (freshness window, public key, chain config)
 * @returns Verification result with per-check details
 */
export async function verifySnapshot(
  snapshot: TrustSnapshot,
  options?: VerifySnapshotOptions,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

  // Step 1 — Structural validation
  try {
    trustSnapshotSchema.parse(snapshot);
    checks.push({ name: "structural", passed: true });
  } catch (e) {
    checks.push({ name: "structural", passed: false, detail: `Schema validation failed: ${(e as Error).message}` });
    return { valid: false, checks, reason: "Structural validation failed" };
  }

  // Step 2 — Hash recomputation
  // Must match builder: snapshot_hash="" and public_key="" in the hashed object
  const { integrity, on_chain: _on_chain, ...rest } = snapshot;
  const snapshotForHashing = {
    ...rest,
    integrity: {
      snapshot_hash: "",
      signature_algorithm: integrity.signature_algorithm,
      public_key: "",
      key_id: integrity.key_id,
    },
  };
  const recomputedHash = sha256Hex(canonicalize(snapshotForHashing));
  const hashMatches = recomputedHash === integrity.snapshot_hash;
  checks.push({
    name: "hash",
    passed: hashMatches,
    detail: hashMatches ? undefined : `Recomputed ${recomputedHash} != stored ${integrity.snapshot_hash}`,
  });
  if (!hashMatches) {
    return { valid: false, checks, reason: "Snapshot hash mismatch" };
  }

  // Step 3 — Signature verification
  let sigValid = false;
  try {
    const publicKey = resolvePublicKey(options?.agentBadgePublicKey);
    sigValid = verifySignature(integrity.snapshot_hash, integrity.signature, publicKey);
  } catch (e) {
    checks.push({ name: "signature", passed: false, detail: `Signature verification error: ${(e as Error).message}` });
    return { valid: false, checks, reason: "Signature verification failed" };
  }
  checks.push({
    name: "signature",
    passed: sigValid,
    detail: sigValid ? undefined : "Ed25519 signature invalid",
  });
  if (!sigValid) {
    return { valid: false, checks, reason: "Signature verification failed" };
  }

  // Step 4 & 5 — On-chain lookup and hash comparison
  if (options?.skipOnChain) {
    checks.push({ name: "on_chain_lookup", passed: true, detail: "Skipped (skipOnChain=true)" });
    checks.push({ name: "on_chain_hash", passed: true, detail: "Skipped (skipOnChain=true)" });
  } else {
    const contractAddress = options?.contractAddress ?? process.env.AGENT_PASSPORT_NFT_ADDRESS ?? "";
    const rpcUrl = options?.rpcUrl ?? process.env.WHITECHAIN_RPC_URL ?? "http://127.0.0.1:8545";

    if (!contractAddress) {
      checks.push({ name: "on_chain_lookup", passed: false, detail: "No contract address configured" });
      checks.push({ name: "on_chain_hash", passed: false, detail: "Skipped — no on-chain lookup" });
      return { valid: false, checks, reason: "On-chain lookup failed: no contract address" };
    }

    try {
      const onChain = await readOnChainAttestation(integrity.snapshot_hash, contractAddress, rpcUrl);

      if (!onChain) {
        checks.push({ name: "on_chain_lookup", passed: false, detail: "No attestation found for snapshot hash" });
        checks.push({ name: "on_chain_hash", passed: false, detail: "Skipped — no on-chain attestation" });
        return { valid: false, checks, reason: "No on-chain attestation found" };
      }

      checks.push({ name: "on_chain_lookup", passed: true, detail: `tokenId=${onChain.tokenId}` });

      // Step 5 — Compare on-chain hash with local hash
      const onChainHashBytes = onChain.snapshotHash;
      const localHashHex = integrity.snapshot_hash.replace(/^sha256:/, "");
      const hashMatch = onChainHashBytes.toLowerCase() === "0x" + localHashHex.toLowerCase();
      checks.push({
        name: "on_chain_hash",
        passed: hashMatch,
        detail: hashMatch ? undefined : `On-chain ${onChainHashBytes} != local ${localHashHex}`,
      });
      if (!hashMatch) {
        return { valid: false, checks, reason: "On-chain hash mismatch" };
      }

      // Check if on-chain attestation is revoked
      if (onChain.revoked) {
        checks.push({ name: "on_chain_revoked", passed: false, detail: "Attestation is revoked on-chain" });
        return { valid: false, checks, reason: "Attestation revoked on-chain" };
      }
      checks.push({ name: "on_chain_revoked", passed: true });
    } catch (e) {
      checks.push({ name: "on_chain_lookup", passed: false, detail: `RPC error: ${(e as Error).message}` });
      checks.push({ name: "on_chain_hash", passed: false, detail: "Skipped — on-chain lookup failed" });
      return { valid: false, checks, reason: "On-chain lookup failed" };
    }
  }

  // Step 6 — Freshness check
  const windowDays = options?.freshnessWindowDays ?? 30;
  const freshness = checkFreshness(snapshot.generated_at, windowDays);
  checks.push({
    name: "freshness",
    passed: freshness.fresh,
    detail: freshness.fresh
      ? undefined
      : `Snapshot age ${freshness.ageDays} days exceeds window ${windowDays} days`,
  });
  if (!freshness.fresh) {
    return { valid: false, checks, reason: "Snapshot expired (freshness window exceeded)" };
  }

  // Step 7 — Domain ownership expiry check
  const expiresAt = snapshot.domain_ownership.verified_at;
  if (!expiresAt) {
    checks.push({ name: "domain_ownership", passed: false, detail: "No verified_at timestamp" });
    return { valid: false, checks, reason: "Domain ownership not verified" };
  }

  // Domain ownership expires 90 days after verification
  const ownershipExpiry = new Date(expiresAt);
  ownershipExpiry.setDate(ownershipExpiry.getDate() + 90);
  const ownershipExpired = ownershipExpiry.getTime() < Date.now();

  checks.push({
    name: "domain_ownership",
    passed: !ownershipExpired,
    detail: ownershipExpired
      ? `Domain ownership expired (verified_at=${expiresAt}, expired=${ownershipExpiry.toISOString()})`
      : undefined,
  });
  if (ownershipExpired) {
    return { valid: false, checks, reason: "Domain ownership expired" };
  }

  return { valid: true, checks };
}
