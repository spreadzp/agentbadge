import { describe, it, expect } from "vitest";
import { snapshotHashToBytes32 } from "../../../src/agent-readiness/trust/attestation-service";

describe("SLICE-102-5: verification-reader", () => {
  describe("snapshotHashToBytes32() (shared util)", () => {
    it("converts sha256: hash for verification reader use", () => {
      const hash = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
      const result = snapshotHashToBytes32(hash);
      expect(result).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");
    });

    it("handles 0x prefixed hash", () => {
      const hash = "0x2222222222222222222222222222222222222222222222222222222222222222";
      const result = snapshotHashToBytes32(hash);
      expect(result).toBe("0x2222222222222222222222222222222222222222222222222222222222222222");
    });

    it("throws for invalid hash", () => {
      expect(() => snapshotHashToBytes32("invalid")).toThrow();
    });
  });
});
