import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  mintPassportNFT,
  transferNFTToAgent,
  submitAuditMessage,
  resetMockState,
} from "@agentbadge/hedera-core";

describe("hedera.service", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_HEDERA", "true");
    vi.stubEnv("MOCK_IPFS", "true");
    vi.stubEnv("HEDERA_OPERATOR_ID", "0.0.5266613");
    vi.stubEnv(
      "HEDERA_OPERATOR_KEY",
      "302e020100300506032b6570042204207a1808c14f6e11817bc7c1b3ab9aa86bef1883e7da58046f8ab84021c30bfce7",
    );
    vi.stubEnv("AUDIT_TOPIC_ID", "0.0.999");
    vi.stubEnv("PASSPORT_TOKEN_ID", "0.0.123");
    vi.clearAllMocks();
    resetMockState();
  });

  describe("mintPassportNFT", () => {
    it("mints NFT and returns serial number", async () => {
      const result = await mintPassportNFT("0.0.123", "ipfs://bafyabc");
      expect(result.tokenId).toBe("0.0.123");
      expect(result.serial).toBe(1);
    });
  });

  describe("transferNFTToAgent", () => {
    it("transfers NFT without error", async () => {
      const { serial } = await mintPassportNFT("0.0.123", "ipfs://bafyabc");
      await expect(transferNFTToAgent("0.0.123", serial, "0.0.999", "0.0.888")).resolves.toBeUndefined();
    });
  });

  describe("submitAuditMessage", () => {
    it("submits message and returns tx hash", async () => {
      const msg = {
        type: "passport_issued" as const,
        did: "did:hcs:0.0.123:1",
        tokenId: "0.0.123",
        serial: 1,
        timestamp: Date.now(),
        tier: "silver" as const,
      };
      const result = await submitAuditMessage(msg);
      expect(typeof result).toBe("string");
      expect(result).toContain("@");
    });
  });
});
