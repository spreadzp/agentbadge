import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifySnapshot } from "../../../src/agent-readiness/trust/snapshot-verifier";
import { verifySignature } from "../../../src/agent-readiness/trust/signature-verifier";
import { checkFreshness } from "../../../src/agent-readiness/trust/freshness-checker";
import {
  makeValidSnapshot,
  makeTamperedHashSnapshot,
  makeInvalidSignatureSnapshot,
  makeStaleSnapshot,
  makeExpiredOwnershipSnapshot,
} from "./fixtures/verification-fixtures";

describe("SLICE-102-6: Snapshot Verification", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AGENTBADGE_SIGNING_PUBLIC_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("verifySignature()", () => {
    it("verifies a valid signature", () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      const valid = verifySignature(
        snapshot.integrity.snapshot_hash,
        snapshot.integrity.signature,
        publicKey,
      );
      expect(valid).toBe(true);
    });

    it("rejects an invalid signature", () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      const valid = verifySignature(
        snapshot.integrity.snapshot_hash,
        Buffer.from("tampered").toString("base64"),
        publicKey,
      );
      expect(valid).toBe(false);
    });

    it("rejects with wrong public key", () => {
      const { snapshot } = makeValidSnapshot();
      const wrongKey = Buffer.from(new Uint8Array(32)).toString("base64");
      const valid = verifySignature(
        snapshot.integrity.snapshot_hash,
        snapshot.integrity.signature,
        wrongKey,
      );
      expect(valid).toBe(false);
    });
  });

  describe("checkFreshness()", () => {
    it("returns fresh for recent timestamp", () => {
      const recent = new Date().toISOString();
      const result = checkFreshness(recent, 30);
      expect(result.fresh).toBe(true);
      expect(result.ageDays).toBe(0);
      expect(result.expires_in_days).toBe(30);
    });

    it("returns not fresh for old timestamp", () => {
      const old = new Date();
      old.setDate(old.getDate() - 60);
      const result = checkFreshness(old.toISOString(), 30);
      expect(result.fresh).toBe(false);
      expect(result.ageDays).toBeGreaterThanOrEqual(59);
    });

    it("returns fresh at exactly window boundary", () => {
      const boundary = new Date();
      boundary.setDate(boundary.getDate() - 30);
      const result = checkFreshness(boundary.toISOString(), 30);
      expect(result.fresh).toBe(true);
    });

    it("computes expires_in_days correctly", () => {
      const ts = new Date();
      ts.setDate(ts.getDate() - 10);
      const result = checkFreshness(ts.toISOString(), 30);
      expect(result.ageDays).toBe(10);
      expect(result.expires_in_days).toBe(20);
    });
  });

  describe("verifySnapshot()", () => {
    it("passes all checks for a valid snapshot (skipOnChain)", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();

      const result = await verifySnapshot(snapshot, {
        agentBadgePublicKey: publicKey,
        skipOnChain: true,
      });

      expect(result.valid).toBe(true);
      expect(result.checks.length).toBeGreaterThanOrEqual(7);

      const allPassed = result.checks.every((c) => c.passed);
      expect(allPassed).toBe(true);
    });

    it("fails on tampered snapshot hash", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      const tampered = makeTamperedHashSnapshot(snapshot);

      const result = await verifySnapshot(tampered, {
        agentBadgePublicKey: publicKey,
        skipOnChain: true,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("hash mismatch");

      const hashCheck = result.checks.find((c) => c.name === "hash");
      expect(hashCheck?.passed).toBe(false);
    });

    it("fails on invalid signature", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      const tampered = makeInvalidSignatureSnapshot(snapshot);

      const result = await verifySnapshot(tampered, {
        agentBadgePublicKey: publicKey,
        skipOnChain: true,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Signature");

      const sigCheck = result.checks.find((c) => c.name === "signature");
      expect(sigCheck?.passed).toBe(false);
    });

    it("fails on stale snapshot (freshness window exceeded)", async () => {
      const { snapshot, publicKey } = makeStaleSnapshot();

      const result = await verifySnapshot(snapshot, {
        agentBadgePublicKey: publicKey,
        skipOnChain: true,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("expired");

      const freshnessCheck = result.checks.find((c) => c.name === "freshness");
      expect(freshnessCheck?.passed).toBe(false);
    });

    it("fails on expired domain ownership", async () => {
      const { snapshot, publicKey } = makeExpiredOwnershipSnapshot();

      const result = await verifySnapshot(snapshot, {
        agentBadgePublicKey: publicKey,
        skipOnChain: true,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Domain ownership expired");

      const ownershipCheck = result.checks.find((c) => c.name === "domain_ownership");
      expect(ownershipCheck?.passed).toBe(false);
    });

    it("each check reports name, passed status, and detail", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();

      const result = await verifySnapshot(snapshot, {
        agentBadgePublicKey: publicKey,
        skipOnChain: true,
      });

      for (const check of result.checks) {
        expect(check.name).toBeTruthy();
        expect(typeof check.passed).toBe("boolean");
        // detail is optional but when present should be a string
        if (check.detail !== undefined) {
          expect(typeof check.detail).toBe("string");
        }
      }
    });

    it("fails when public key not available", async () => {
      const { snapshot } = makeValidSnapshot();

      const result = await verifySnapshot(snapshot, {
        skipOnChain: true,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Signature");

      const sigCheck = result.checks.find((c) => c.name === "signature");
      expect(sigCheck?.passed).toBe(false);
    });

    it("uses env var for public key when not in options", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      process.env.AGENTBADGE_SIGNING_PUBLIC_KEY = publicKey;

      const result = await verifySnapshot(snapshot, {
        skipOnChain: true,
      });

      expect(result.valid).toBe(true);
    });
  });
});
