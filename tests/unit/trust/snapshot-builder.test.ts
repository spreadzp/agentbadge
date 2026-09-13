import { describe, it, expect } from "vitest";
import { buildTrustSnapshot } from "../../../src/agent-readiness/trust/snapshot-builder";
import { verifySnapshotSignature } from "../../../src/agent-readiness/trust/signer";
import { extractEvidenceHashes } from "../../../src/agent-readiness/trust/evidence-hasher";
import { sha256Hex } from "../../../src/agent-readiness/trust/hashing";
import { canonicalize } from "../../../src/agent-readiness/trust/canonical-json";
import { trustSnapshotSchema } from "../../../src/agent-readiness/trust/trust-schema";
import {
  makeTestSigningKey,
  makeTestDomainOwnership,
  makeTestProfile,
} from "./fixtures/trust-snapshot-fixture";

/**
 * SLICE-102-2: Snapshot Builder Core tests.
 */

const FIXED_TIMESTAMP = "2026-09-04T22:00:00Z";
const FIXED_ENDPOINT = "https://agentbadge.xyz/api/profile/api.example.com";

describe("SLICE-102-2: buildTrustSnapshot()", () => {
  it("produces a valid TrustSnapshot matching schema", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const snapshot = buildTrustSnapshot({
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    });

    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it("sets snapshot_version and spec_version correctly", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const snapshot = buildTrustSnapshot({
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    });

    expect(snapshot.snapshot_version).toBe("1.0.0");
    expect(snapshot.spec_version).toBe("0.10.0");
  });

  it("computes profile_ref.profile_hash as SHA-256 of canonical profile", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const snapshot = buildTrustSnapshot({
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    });

    const expectedHash = sha256Hex(canonicalize(profile));
    expect(snapshot.profile_ref.profile_hash).toBe(expectedHash);
  });

  it("computes evidence_root.merkle_root from assertion hashes", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const snapshot = buildTrustSnapshot({
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    });

    const evidenceHashes = extractEvidenceHashes(assertions);
    expect(snapshot.evidence_root.assertion_count).toBe(assertions.length);
    expect(snapshot.evidence_root.evidence_hashes).toEqual(evidenceHashes);
    // Merkle root should match (concat hash for < 10 items)
    if (assertions.length < 10) {
      const expectedRoot = sha256Hex(evidenceHashes.join(""));
      expect(snapshot.evidence_root.merkle_root).toBe(expectedRoot);
    }
  });

  it("extracts score_summary from profile readiness", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const snapshot = buildTrustSnapshot({
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    });

    expect(snapshot.score_summary.total).toBe(profile.readiness.score);
    expect(snapshot.score_summary.grade).toBe(profile.readiness.grade);
    expect(snapshot.score_summary.verified_rules).toBe(profile.readiness.verified_rules);
    expect(snapshot.score_summary.total_rules).toBe(profile.readiness.total_rules);
    expect(snapshot.score_summary.gaps).toBe(profile.readiness.gaps);
    expect(snapshot.score_summary.conflicts).toBe(profile.readiness.conflicts);
  });

  it("sets on_chain to undefined (not yet attested)", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const snapshot = buildTrustSnapshot({
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    });

    expect(snapshot.on_chain).toBeUndefined();
  });

  it("produces valid Ed25519 signature (verify round-trip)", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const snapshot = buildTrustSnapshot({
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    });

    const isValid = verifySnapshotSignature(
      snapshot.integrity.snapshot_hash,
      snapshot.integrity.signature,
      snapshot.integrity.public_key,
    );
    expect(isValid).toBe(true);
  });

  it("is pure — same input produces same output (including signature)", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const input = {
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    };

    const snapshot1 = buildTrustSnapshot(input);
    const snapshot2 = buildTrustSnapshot(input);

    expect(snapshot1).toEqual(snapshot2);
    expect(snapshot1.integrity.signature).toBe(snapshot2.integrity.signature);
    expect(snapshot1.integrity.snapshot_hash).toBe(snapshot2.integrity.snapshot_hash);
  });

  it("different signing keys produce different signatures", () => {
    const { profile, assertions } = makeTestProfile();
    const key1 = makeTestSigningKey();
    const key2 = makeTestSigningKey();

    const input = {
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      keyId: "test-key",
      timestamp: FIXED_TIMESTAMP,
    };

    const snapshot1 = buildTrustSnapshot({ ...input, signingKey: key1 });
    const snapshot2 = buildTrustSnapshot({ ...input, signingKey: key2 });

    // snapshot_hash should be the same (it's computed before signing)
    expect(snapshot1.integrity.snapshot_hash).toBe(snapshot2.integrity.snapshot_hash);
    // But signatures and public keys should differ
    expect(snapshot1.integrity.signature).not.toBe(snapshot2.integrity.signature);
    expect(snapshot1.integrity.public_key).not.toBe(snapshot2.integrity.public_key);
  });

  it("different timestamps produce different snapshot_hashes", () => {
    const { profile, assertions } = makeTestProfile();
    const key = makeTestSigningKey();

    const input = {
      profile,
      assertions,
      domain: "api.example.com",
      profileEndpoint: FIXED_ENDPOINT,
      domainOwnership: makeTestDomainOwnership(),
      signingKey: key,
      keyId: "test-key",
    };

    const snapshot1 = buildTrustSnapshot({ ...input, timestamp: "2026-09-04T22:00:00Z" });
    const snapshot2 = buildTrustSnapshot({ ...input, timestamp: "2026-09-05T10:00:00Z" });

    expect(snapshot1.integrity.snapshot_hash).not.toBe(snapshot2.integrity.snapshot_hash);
  });
});

describe("SLICE-102-2: extractEvidenceHashes()", () => {
  it("returns one hash per assertion", () => {
    const { assertions } = makeTestProfile();
    const hashes = extractEvidenceHashes(assertions);
    expect(hashes.length).toBe(assertions.length);
  });

  it("all hashes are sha256: format", () => {
    const { assertions } = makeTestProfile();
    const hashes = extractEvidenceHashes(assertions);
    for (const h of hashes) {
      expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("is deterministic — same assertions produce same hashes", () => {
    const { assertions } = makeTestProfile();
    const hashes1 = extractEvidenceHashes(assertions);
    const hashes2 = extractEvidenceHashes(assertions);
    expect(hashes1).toEqual(hashes2);
  });
});
