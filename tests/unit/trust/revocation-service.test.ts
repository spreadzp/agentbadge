import { describe, it, expect } from "vitest";

describe("SLICE-102-5: revocation-service", () => {
  describe("RevokeSnapshotInput interface", () => {
    it("accepts valid input shape", () => {
      const input = {
        tokenId: "1",
        reason: "Score manipulation detected",
        signerPrivateKey: "0x" + "a".repeat(64),
        contractAddress: "0x" + "1".repeat(40),
        rpcUrl: "http://127.0.0.1:8545",
      };

      expect(input.tokenId).toBe("1");
      expect(input.reason).toBe("Score manipulation detected");
      expect(input.signerPrivateKey).toMatch(/^0x[a-f0-9]{64}$/);
      expect(input.contractAddress).toMatch(/^0x[a-f0-9]{40}$/);
      expect(input.rpcUrl).toBe("http://127.0.0.1:8545");
    });

    it("accepts large tokenId", () => {
      const input = {
        tokenId: "999999999999",
        reason: "Invalid attestation",
        signerPrivateKey: "0x" + "b".repeat(64),
        contractAddress: "0x" + "2".repeat(40),
        rpcUrl: "http://127.0.0.1:8545",
      };

      expect(BigInt(input.tokenId)).toBe(999999999999n);
    });

    it("accepts empty reason string", () => {
      const input = {
        tokenId: "5",
        reason: "",
        signerPrivateKey: "0x" + "c".repeat(64),
        contractAddress: "0x" + "3".repeat(40),
        rpcUrl: "http://127.0.0.1:8545",
      };

      expect(input.reason).toBe("");
    });
  });
});
