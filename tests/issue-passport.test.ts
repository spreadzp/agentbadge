import { describe, it, expect, vi, beforeEach } from "vitest";

import { issuePassport } from "@agentbadge/passport";
import { resetMockState } from "@agentbadge/hedera-core";

describe("issuePassport", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_IPFS", "true");
    vi.stubEnv("MOCK_HEDERA", "true");
    vi.stubEnv("PASSPORT_TOKEN_ID", "0.0.123");
    vi.stubEnv("HEDERA_OPERATOR_ID", "0.0.5266613");
    resetMockState();
  });

  it("uploads IPFS metadata, mints NFT, transfers, submits audit, returns result", async () => {
    const result = await issuePassport(
      "0.0.7654321",
      "0xfakesig",
      "silver",
      "TradingBot",
      ["api_call", "payment"],
      "https://agent.example.com",
    );

    expect(result).toEqual({
      tokenId: "0.0.123",
      serialNumber: expect.any(Number),
      did: expect.stringMatching(/^did:hcs:0\.0\.123:\d+$/),
      tier: "silver",
      hashScanLink: expect.stringContaining("hashscan.io"),
    });
  });

  it("generates DID in correct format: did:hcs:{tokenId}:{serial}", async () => {
    const result = await issuePassport(
      "0.0.7654321",
      "0xfakesig",
      "bronze",
      "TestBot",
      ["data_provide"],
      "https://test.example.com",
    );

    expect(result.did).toBe("did:hcs:0.0.123:1");
  });

  it("includes correct tier in result", async () => {
    const result = await issuePassport(
      "0.0.7654321",
      "0xfakesig",
      "gold",
      "GoldBot",
      ["orchestration"],
      "https://gold.example.com",
    );

    expect(result.tier).toBe("gold");
  });
});
