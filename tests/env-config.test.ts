import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config/env";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MOCK_HEDERA;
    delete process.env.MOCK_X402;
    delete process.env.MOCK_IPFS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("produces a correctly-typed AppConfig when all required vars are present", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";
    process.env.PORT = "4021";

    const config = loadConfig();

    expect(config.hederaOperatorId).toBe("0.0.5266613");
    expect(config.hederaOperatorKey).toBe("302e020100300506032b657004220420abcdef");
    expect(config.hederaNetwork).toBe("testnet");
    expect(config.passportTokenId).toBe("0.0.1234567");
    expect(config.auditTopicId).toBe("0.0.7654321");
    expect(config.directoryTopicId).toBe("0.0.8765432");
    expect(config.x402FacilitatorUrl).toBe("https://api.testnet.blocky402.com");
    expect(config.x402FeePayer).toBe("0.0.7162784");
    expect(config.x402Treasury).toBe("0.0.8011510");
    expect(config.ipfsApiKey).toBe("test-key");
    expect(config.ipfsApiSecret).toBe("test-secret");
    expect(config.port).toBe(4021);
    expect(config.mockHedera).toBe(false);
    expect(config.mockX402).toBe(false);
    expect(config.mockIpfs).toBe(false);
  });

  it("throws a single aggregated error listing ALL missing vars when several are absent", () => {
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.HEDERA_OPERATOR_KEY;
    delete process.env.PASSPORT_TOKEN_ID;
    delete process.env.AUDIT_TOPIC_ID;

    expect(() => loadConfig()).toThrow(/HEDERA_OPERATOR_ID/);
    expect(() => loadConfig()).toThrow(/HEDERA_OPERATOR_KEY/);
    expect(() => loadConfig()).toThrow(/PASSPORT_TOKEN_ID/);
    expect(() => loadConfig()).toThrow(/AUDIT_TOPIC_ID/);
  });

  it("rejects a malformed HEDERA_OPERATOR_ID (not matching 0.0.X)", () => {
    process.env.HEDERA_OPERATOR_ID = "invalid-id";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";

    expect(() => loadConfig()).toThrow(/HEDERA_OPERATOR_ID/);
  });

  it("accepts mock mode flags and sets them to true", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";
    process.env.MOCK_HEDERA = "true";
    process.env.MOCK_X402 = "true";
    process.env.MOCK_IPFS = "true";

    const config = loadConfig();

    expect(config.mockHedera).toBe(true);
    expect(config.mockX402).toBe(true);
    expect(config.mockIpfs).toBe(true);
  });

  it("rejects an invalid x402_FACILITATOR_URL (not a URL)", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "not-a-url";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";

    expect(() => loadConfig()).toThrow(/x402_FACILITATOR_URL/);
  });

  it("uses default PORT=4021 when not specified", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";
    delete process.env.PORT;

    const config = loadConfig();

    expect(config.port).toBe(4021);
  });
});
