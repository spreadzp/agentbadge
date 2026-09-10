/**
 * SLICE-102-2: Trust Snapshot Builder.
 *
 * buildTrustSnapshot() — pure function that takes a KnowledgeProfile,
 * scan report data, assertions, domain ownership proof, and signing key,
 * and produces a signed TrustSnapshot.
 */

import { canonicalize } from "./canonical-json";
import { sha256Hex, merkleRoot } from "./hashing";
import { extractEvidenceHashes } from "./evidence-hasher";
import { signSnapshot } from "./signer";
import type { Assertion } from "../rule-engine/assertion-builder";
import type { KnowledgeProfile } from "../profile/profile-schema";
import type { TrustSnapshot, DomainOwnership } from "./trust-schema";

export interface SnapshotBuilderInput {
  profile: KnowledgeProfile;
  assertions: Assertion[];
  domain: string;
  profileEndpoint: string;
  domainOwnership: DomainOwnership;
  signingKey: Uint8Array;
  keyId: string;
  timestamp: string;
  reportId?: string;
}

/**
 * Build a TrustSnapshot from a KnowledgeProfile and scan data.
 *
 * Pure function: same input → same output (including signature).
 * Timestamp is passed as parameter for deterministic testing.
 */
export function buildTrustSnapshot(input: SnapshotBuilderInput): TrustSnapshot {
  const {
    profile,
    assertions,
    domain,
    profileEndpoint,
    domainOwnership,
    signingKey,
    keyId,
    timestamp,
    reportId,
  } = input;

  // 1. Profile hash
  const profileHash = sha256Hex(canonicalize(profile));

  // 2. Evidence hashes
  const evidenceHashes = extractEvidenceHashes(assertions);
  const root = merkleRoot(evidenceHashes);

  // 3. Score summary from profile
  const scoreSummary = {
    total: profile.readiness.score,
    grade: profile.readiness.grade,
    verified_rules: profile.readiness.verified_rules,
    total_rules: profile.readiness.total_rules,
    gaps: profile.readiness.gaps,
    conflicts: profile.readiness.conflicts,
  };

  // 4. Build snapshot without signature and on_chain for hash computation
  const snapshotForHashing = {
    snapshot_version: "1.0.0",
    spec_version: "0.10.0",
    domain,
    generated_at: timestamp,
    profile_ref: {
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      endpoint: profileEndpoint,
    },
    evidence_root: {
      assertion_count: assertions.length,
      evidence_hashes: evidenceHashes,
      merkle_root: root,
      computed_at: timestamp,
    },
    score_summary: scoreSummary,
    domain_ownership: domainOwnership,
    integrity: {
      snapshot_hash: "", // placeholder — will be filled after hash computation
      signature_algorithm: "ed25519" as const,
      public_key: "", // placeholder
      key_id: keyId,
    },
  };

  // 5. Compute snapshot hash (canonical JSON of snapshot without signature value and on_chain)
  const snapshotHash = sha256Hex(canonicalize({
    ...snapshotForHashing,
    integrity: {
      snapshot_hash: "",
      signature_algorithm: "ed25519",
      public_key: "",
      key_id: keyId,
    },
  }));

  // 6. Sign the snapshot hash
  const signature = signSnapshot(snapshotHash, signingKey);

  // 7. Assemble final snapshot
  const snapshot: TrustSnapshot = {
    snapshot_version: "1.0.0",
    spec_version: "0.10.0",
    domain,
    generated_at: timestamp,
    profile_ref: {
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      endpoint: profileEndpoint,
    },
    evidence_root: {
      assertion_count: assertions.length,
      evidence_hashes: evidenceHashes,
      merkle_root: root,
      computed_at: timestamp,
    },
    score_summary: scoreSummary,
    domain_ownership: domainOwnership,
    integrity: {
      snapshot_hash: snapshotHash,
      signature_algorithm: "ed25519",
      signature: signature.signature,
      public_key: signature.public_key,
      key_id: keyId,
    },
    on_chain: undefined,
  };

  return snapshot;
}
