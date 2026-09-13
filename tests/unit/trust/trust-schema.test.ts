import { describe, it, expect } from "vitest";
import {
  trustSnapshotSchema,
  trustSnapshotForHashingSchema,
  parseSnapshot,
  parseSnapshotForVerification,
  type TrustSnapshot,
} from "../../../src/agent-readiness/trust/trust-schema";

/**
 * SLICE-102-1: Trust Snapshot schema tests.
 */

function makeValidSnapshot(): TrustSnapshot {
  return {
    snapshot_version: "1.0.0",
    spec_version: "0.10.0",
    domain: "api.example.com",
    generated_at: "2026-09-04T22:00:00Z",
    profile_ref: {
      profile_version: "1.0.0",
      profile_hash: "sha256:1b4f0e9851971998e732078544c96b36c3d01cedf7caa332359d6f1d83567014",
      endpoint: "https://agentbadge.xyz/api/profile/api.example.com",
    },
    evidence_root: {
      assertion_count: 40,
      evidence_hashes: ["sha256:60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752"],
      merkle_root: "sha256:fd61a03af4f77d870fc21e05e7e80678095c92d808cfb3b5c279ee04c74aca13",
      computed_at: "2026-09-04T22:00:00Z",
    },
    score_summary: {
      total: 78,
      grade: "B",
      verified_rules: 14,
      total_rules: 20,
      gaps: 6,
      conflicts: 2,
    },
    domain_ownership: {
      method: "dns_txt",
      verified: true,
      verified_at: "2026-09-04T21:55:00Z",
      challenge_token: "ab_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      proof: "TXT record verified",
    },
    integrity: {
      snapshot_hash: "sha256:a4e624d686e03ed2767c0abd85c14426b0b1157d2ce81d27bb4fe4f6f01d688a",
      signature_algorithm: "ed25519",
      signature: "base64signature",
      public_key: "base64pubkey",
      key_id: "default",
    },
    on_chain: {
      chain: "hedera",
      chain_id: 295,
      contract_address: "0xABC",
      token_id: 42,
      attested_at: "2026-09-04T22:01:00Z",
      attested_by: "0xDEF",
      tx_hash: "0x123",
      revoked: false,
    },
  };
}

describe("SLICE-102-1: trustSnapshotSchema validation", () => {
  it("validates a correct snapshot with on_chain", () => {
    const snapshot = makeValidSnapshot();
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it("validates a correct snapshot without on_chain", () => {
    const snapshot = makeValidSnapshot();
    delete snapshot.on_chain;
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it("rejects invalid snapshot_version", () => {
    const snapshot = makeValidSnapshot();
    (snapshot as any).snapshot_version = 123;
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("rejects invalid profile_hash format", () => {
    const snapshot = makeValidSnapshot();
    snapshot.profile_ref.profile_hash = "not-a-hash";
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("rejects invalid domain_ownership method", () => {
    const snapshot = makeValidSnapshot();
    (snapshot.domain_ownership as any).method = "invalid_method";
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("rejects score > 100", () => {
    const snapshot = makeValidSnapshot();
    snapshot.score_summary.total = 101;
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("rejects negative gaps", () => {
    const snapshot = makeValidSnapshot();
    snapshot.score_summary.gaps = -1;
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("rejects invalid signature_algorithm", () => {
    const snapshot = makeValidSnapshot();
    (snapshot.integrity as any).signature_algorithm = "rsa";
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("rejects invalid chain name", () => {
    const snapshot = makeValidSnapshot();
    (snapshot.on_chain as any).chain = "ethereum";
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field (domain)", () => {
    const snapshot = makeValidSnapshot();
    delete (snapshot as any).domain;
    const result = trustSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });
});

describe("SLICE-102-1: parseSnapshot()", () => {
  it("returns typed TrustSnapshot on valid input", () => {
    const snapshot = parseSnapshot(makeValidSnapshot());
    expect(snapshot.snapshot_version).toBe("1.0.0");
    expect(snapshot.domain).toBe("api.example.com");
    expect(snapshot.score_summary.total).toBe(78);
  });

  it("throws on invalid input", () => {
    expect(() => parseSnapshot({ foo: "bar" })).toThrow();
  });
});

describe("SLICE-102-1: trustSnapshotForHashingSchema", () => {
  it("validates snapshot without signature field", () => {
    const snapshot = makeValidSnapshot();
    const forHashing = {
      snapshot_version: snapshot.snapshot_version,
      spec_version: snapshot.spec_version,
      domain: snapshot.domain,
      generated_at: snapshot.generated_at,
      profile_ref: snapshot.profile_ref,
      evidence_root: snapshot.evidence_root,
      score_summary: snapshot.score_summary,
      domain_ownership: snapshot.domain_ownership,
      integrity: {
        snapshot_hash: snapshot.integrity.snapshot_hash,
        signature_algorithm: snapshot.integrity.signature_algorithm,
        public_key: snapshot.integrity.public_key,
        key_id: snapshot.integrity.key_id,
      },
    };
    const result = trustSnapshotForHashingSchema.safeParse(forHashing);
    expect(result.success).toBe(true);
  });

  it("parseSnapshotForVerification returns typed snapshot", () => {
    const snapshot = makeValidSnapshot();
    const forHashing = {
      snapshot_version: snapshot.snapshot_version,
      spec_version: snapshot.spec_version,
      domain: snapshot.domain,
      generated_at: snapshot.generated_at,
      profile_ref: snapshot.profile_ref,
      evidence_root: snapshot.evidence_root,
      score_summary: snapshot.score_summary,
      domain_ownership: snapshot.domain_ownership,
      integrity: {
        snapshot_hash: snapshot.integrity.snapshot_hash,
        signature_algorithm: snapshot.integrity.signature_algorithm,
        public_key: snapshot.integrity.public_key,
        key_id: snapshot.integrity.key_id,
      },
    };
    const result = parseSnapshotForVerification(forHashing);
    expect(result.domain).toBe("api.example.com");
    expect(result.integrity.snapshot_hash).toBeDefined();
    // Should NOT have signature field
    expect((result.integrity as any).signature).toBeUndefined();
  });
});

describe("SLICE-102-1: Zero-drift — schema fields match spec §13.1", () => {
  it("has all top-level fields from spec", () => {
    const snapshot = makeValidSnapshot();
    const keys = Object.keys(snapshot);
    expect(keys).toContain("snapshot_version");
    expect(keys).toContain("spec_version");
    expect(keys).toContain("domain");
    expect(keys).toContain("generated_at");
    expect(keys).toContain("profile_ref");
    expect(keys).toContain("evidence_root");
    expect(keys).toContain("score_summary");
    expect(keys).toContain("domain_ownership");
    expect(keys).toContain("integrity");
    expect(keys).toContain("on_chain");
  });

  it("profile_ref has profile_version, profile_hash, endpoint", () => {
    const snapshot = makeValidSnapshot();
    expect(snapshot.profile_ref).toHaveProperty("profile_version");
    expect(snapshot.profile_ref).toHaveProperty("profile_hash");
    expect(snapshot.profile_ref).toHaveProperty("endpoint");
  });

  it("evidence_root has assertion_count, evidence_hashes, merkle_root, computed_at", () => {
    const snapshot = makeValidSnapshot();
    expect(snapshot.evidence_root).toHaveProperty("assertion_count");
    expect(snapshot.evidence_root).toHaveProperty("evidence_hashes");
    expect(snapshot.evidence_root).toHaveProperty("merkle_root");
    expect(snapshot.evidence_root).toHaveProperty("computed_at");
  });

  it("score_summary has total, grade, verified_rules, total_rules, gaps, conflicts", () => {
    const snapshot = makeValidSnapshot();
    expect(snapshot.score_summary).toHaveProperty("total");
    expect(snapshot.score_summary).toHaveProperty("grade");
    expect(snapshot.score_summary).toHaveProperty("verified_rules");
    expect(snapshot.score_summary).toHaveProperty("total_rules");
    expect(snapshot.score_summary).toHaveProperty("gaps");
    expect(snapshot.score_summary).toHaveProperty("conflicts");
  });

  it("domain_ownership has method, verified, verified_at, challenge_token, proof", () => {
    const snapshot = makeValidSnapshot();
    expect(snapshot.domain_ownership).toHaveProperty("method");
    expect(snapshot.domain_ownership).toHaveProperty("verified");
    expect(snapshot.domain_ownership).toHaveProperty("verified_at");
    expect(snapshot.domain_ownership).toHaveProperty("challenge_token");
    expect(snapshot.domain_ownership).toHaveProperty("proof");
  });

  it("integrity has snapshot_hash, signature_algorithm, signature, public_key, key_id", () => {
    const snapshot = makeValidSnapshot();
    expect(snapshot.integrity).toHaveProperty("snapshot_hash");
    expect(snapshot.integrity).toHaveProperty("signature_algorithm");
    expect(snapshot.integrity).toHaveProperty("signature");
    expect(snapshot.integrity).toHaveProperty("public_key");
    expect(snapshot.integrity).toHaveProperty("key_id");
  });

  it("on_chain has chain, chain_id, contract_address, token_id, attested_at, attested_by, tx_hash, revoked", () => {
    const snapshot = makeValidSnapshot();
    expect(snapshot.on_chain).toHaveProperty("chain");
    expect(snapshot.on_chain).toHaveProperty("chain_id");
    expect(snapshot.on_chain).toHaveProperty("contract_address");
    expect(snapshot.on_chain).toHaveProperty("token_id");
    expect(snapshot.on_chain).toHaveProperty("attested_at");
    expect(snapshot.on_chain).toHaveProperty("attested_by");
    expect(snapshot.on_chain).toHaveProperty("tx_hash");
    expect(snapshot.on_chain).toHaveProperty("revoked");
  });

  it("domain_ownership.method accepts all three methods from spec", () => {
    for (const method of ["dns_txt", "well_known_file", "well_known_meta"] as const) {
      const snapshot = makeValidSnapshot();
      snapshot.domain_ownership.method = method;
      const result = trustSnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(true);
    }
  });

  it("on_chain.chain accepts hedera and base", () => {
    for (const chain of ["hedera", "base"] as const) {
      const snapshot = makeValidSnapshot();
      snapshot.on_chain!.chain = chain;
      const result = trustSnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(true);
    }
  });
});
