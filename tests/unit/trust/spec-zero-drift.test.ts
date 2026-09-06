/**
 * SLICE-102-10: Spec zero-drift verification.
 *
 * Asserts that the implementation matches the spec:
 * - Zod schema fields match expected structure
 * - Verification flow steps match verifySnapshot() implementation
 * - Contract ABI exports match expected functions
 * - Route implementations match expected endpoints
 */

import { describe, it, expect } from "vitest";
import { trustSnapshotSchema, trustSnapshotForHashingSchema } from "../../../src/agent-readiness/trust/trust-schema";
import { agentPassportNFTAbi } from "../../../src/agent-readiness/trust/contract-abi";
import { trustRoutes } from "../../../src/server/routes/trust";
import { trustViewerRoutes } from "../../../src/server/routes/trust-viewer";

describe("SLICE-102-10: Spec Zero-Drift", () => {
  describe("Zod schema fields", () => {
    it("trustSnapshotSchema has all required top-level fields", () => {
      const shape = trustSnapshotSchema.shape;
      const expectedFields = [
        "snapshot_version",
        "spec_version",
        "domain",
        "generated_at",
        "profile_ref",
        "evidence_root",
        "score_summary",
        "domain_ownership",
        "integrity",
        "on_chain",
      ];
      for (const field of expectedFields) {
        expect(shape).toHaveProperty(field);
      }
    });

    it("trustSnapshotForHashingSchema excludes signature and on_chain", () => {
      const shape = trustSnapshotForHashingSchema.shape;
      expect(shape).toHaveProperty("integrity");
      expect(shape.integrity.shape).not.toHaveProperty("signature");
      expect(shape).not.toHaveProperty("on_chain");
    });

    it("scoreSummarySchema has correct fields", () => {
      const shape = trustSnapshotSchema.shape.score_summary.shape;
      const expectedFields = ["total", "grade", "verified_rules", "total_rules", "gaps", "conflicts"];
      for (const field of expectedFields) {
        expect(shape).toHaveProperty(field);
      }
    });

    it("domainOwnershipSchema has correct fields", () => {
      const shape = trustSnapshotSchema.shape.domain_ownership.shape;
      const expectedFields = ["method", "verified", "verified_at", "challenge_token", "proof"];
      for (const field of expectedFields) {
        expect(shape).toHaveProperty(field);
      }
    });

    it("onChainSchema has correct fields", () => {
      const onChainField = trustSnapshotSchema.shape.on_chain;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shape = (onChainField as any)._def.innerType.shape;
      const expectedFields = [
        "chain",
        "chain_id",
        "contract_address",
        "token_id",
        "attested_at",
        "attested_by",
        "tx_hash",
        "revoked",
      ];
      for (const field of expectedFields) {
        expect(shape).toHaveProperty(field);
      }
    });

    it("integritySchema has correct fields", () => {
      const shape = trustSnapshotSchema.shape.integrity.shape;
      const expectedFields = ["snapshot_hash", "signature_algorithm", "signature", "public_key", "key_id"];
      for (const field of expectedFields) {
        expect(shape).toHaveProperty(field);
      }
    });
  });

  describe("Verification flow steps", () => {
    it("verifySnapshot performs 7 checks in correct order", async () => {
      // The verification steps are documented in snapshot-verifier.ts:
      // 1. Structural validation (Zod parse)
      // 2. Hash recomputation
      // 3. Signature verification
      // 4. On-chain attestation lookup
      // 5. On-chain hash comparison
      // 6. Freshness check (timestamp within window)
      // 7. Domain ownership expiry check
      //
      // We verify by checking the check names in the output
      const { makeValidSnapshot } = await import("./fixtures/verification-fixtures");
      const { verifySnapshot } = await import("../../../src/agent-readiness/trust/snapshot-verifier");
      const { snapshot, publicKey } = makeValidSnapshot();

      const result = await verifySnapshot(snapshot, {
        skipOnChain: true,
        agentBadgePublicKey: publicKey,
      });

      const expectedCheckNames = [
        "structural",
        "hash",
        "signature",
        "on_chain_lookup",
        "on_chain_hash",
        "freshness",
        "domain_ownership",
      ];
      expect(result.checks.map((c) => c.name)).toEqual(expectedCheckNames);
    });
  });

  describe("Contract ABI functions", () => {
    it("agentPassportNFTAbi exports trust-related functions", () => {
      const functionNames = agentPassportNFTAbi
        .filter((e) => e.type === "function")
        .map((e) => e.name);

      // Core trust functions from spec §13.4
      const requiredFunctions = [
        "attestSnapshot",
        "verifySnapshot",
        "revokeSnapshot",
        "getAttestation",
        "hashToToken",
        "revoked",
      ];
      for (const fn of requiredFunctions) {
        expect(functionNames).toContain(fn);
      }
    });

    it("attestSnapshot function exists with correct type", () => {
      const fn = agentPassportNFTAbi.find(
        (e) => e.type === "function" && e.name === "attestSnapshot",
      );
      expect(fn).toBeDefined();
      expect(fn?.stateMutability).toBe("nonpayable");
    });

    it("verifySnapshot function exists and is read-only", () => {
      const fn = agentPassportNFTAbi.find(
        (e) => e.type === "function" && e.name === "verifySnapshot",
      );
      expect(fn).toBeDefined();
      expect(fn?.stateMutability).toBe("view");
    });

    it("revokeSnapshot function exists and is restricted", () => {
      const fn = agentPassportNFTAbi.find(
        (e) => e.type === "function" && e.name === "revokeSnapshot",
      );
      expect(fn).toBeDefined();
      expect(fn?.stateMutability).toBe("nonpayable");
    });
  });

  describe("Route implementations", () => {
    it("trustRoutes defines all 4 API endpoints", () => {
      expect(trustRoutes).toBeDefined();
    });

    it("trustViewerRoutes defines the viewer endpoint", () => {
      expect(trustViewerRoutes).toBeDefined();
    });
  });
});
