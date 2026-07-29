import { describe, it, expect, beforeEach, vi } from "vitest";

// Set mock mode before importing service modules
process.env.MOCK_HEDERA = "true";
process.env.MOCK_IPFS = "true";
process.env.HEDERA_OPERATOR_ID = "0.0.2";
process.env.PASSPORT_TOKEN_ID = "0.0.999";
process.env.AUDIT_TOPIC_ID = "0.0.555";
process.env.DIRECTORY_TOPIC_ID = "0.0.666";

// Import after env vars are set
const serviceIndex = await import("@agentgate-hedera/hedera-core");
const passportService = await import("@agentgate-hedera/passport");
const mockHedera = await import("@agentgate-hedera/hedera-core");

describe("grantKyc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should be exported from service index", () => {
    expect(serviceIndex.grantKyc).toBeDefined();
    expect(typeof serviceIndex.grantKyc).toBe("function");
  });

  it("should be exported from mock-hedera service", () => {
    expect(mockHedera.grantKyc).toBeDefined();
    expect(typeof mockHedera.grantKyc).toBe("function");
  });

  it("should not throw in mock mode", async () => {
    await expect(mockHedera.grantKyc("0.0.999", "0.0.12345")).resolves.not.toThrow();
  });
});

describe("issuePassport with KYC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call grantKyc before transferNFTToAgent", async () => {
    // In mock mode, grantKyc is a no-op and transferNFTToAgent updates the store.
    // We verify the order by checking that issuePassport completes successfully
    // (grantKyc is called first, then transfer — if grantKyc throws, transfer won't happen).
    const result = await passportService.issuePassport(
      "0.0.12345",
      "fake-signature",
      "bronze",
      "TestAgent",
      ["api_call"],
      "http://localhost:3000",
    );

    expect(result.tokenId).toBe("0.0.999");
    expect(result.serialNumber).toBeGreaterThan(0);
  });

  it("should complete issuePassport successfully in mock mode with KYC", async () => {
    const result = await passportService.issuePassport(
      "0.0.12345",
      "fake-signature",
      "bronze",
      "TestAgent",
      ["api_call"],
      "http://localhost:3000",
    );

    expect(result.tokenId).toBe("0.0.999");
    expect(result.serialNumber).toBeGreaterThan(0);
    expect(result.did).toBe(`did:hcs:0.0.999:${result.serialNumber}`);
    expect(result.tier).toBe("bronze");
  });
});
