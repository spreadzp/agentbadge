import { describe, it, expect } from "vitest";
import { snapshotHashToBytes32 } from "../../../src/agent-readiness/trust/attestation-service";

describe("SLICE-102-5: attestation-service", () => {
  describe("snapshotHashToBytes32()", () => {
    it("converts sha256: prefixed hash to bytes32", () => {
      const hash = "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const result = snapshotHashToBytes32(hash);
      expect(result).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    });

    it("converts 0x prefixed hash to bytes32", () => {
      const hash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const result = snapshotHashToBytes32(hash);
      expect(result).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    });

    it("converts bare hex hash to bytes32", () => {
      const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const result = snapshotHashToBytes32(hash);
      expect(result).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    });

    it("lowercases uppercase hex", () => {
      const hash = "sha256:ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890";
      const result = snapshotHashToBytes32(hash);
      expect(result).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    });

    it("throws for invalid length (too short)", () => {
      const hash = "sha256:abc123";
      expect(() => snapshotHashToBytes32(hash)).toThrow("Invalid snapshot hash length");
    });

    it("throws for invalid length (too long)", () => {
      const hash = "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ff";
      expect(() => snapshotHashToBytes32(hash)).toThrow("Invalid snapshot hash length");
    });

    it("throws for empty string", () => {
      expect(() => snapshotHashToBytes32("")).toThrow("Invalid snapshot hash length");
    });
  });
});
