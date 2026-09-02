/**
 * SLICE-83-4: Config singleton tests.
 *
 * Verifies that getConfig() returns a cached singleton, throws on missing
 * required vars, and doesn't re-validate on subsequent calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, getConfig, resetConfigCache } from "../../src/config/env";

describe("SLICE-83-4: getConfig singleton", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfigCache();
    // Set required vars for valid config
    process.env.HEDERA_OPERATOR_ID = "0.0.1001";
    process.env.HEDERA_OPERATOR_KEY = "test-key";
    process.env.PASSPORT_TOKEN_ID = "0.0.1002";
    process.env.AUDIT_TOPIC_ID = "0.0.1003";
    process.env.DIRECTORY_TOPIC_ID = "0.0.1004";
    process.env["x402_FACILITATOR_URL"] = "https://facilitator.example.com";
    process.env["x402_FEE_PAYER"] = "0.0.1005";
    process.env["x402_TREASURY"] = "0.0.1006";
    process.env.IPFS_API_KEY = "test-ipfs-key";
    process.env.IPFS_API_SECRET = "test-ipfs-secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it("getConfig returns valid config when env vars are set", () => {
    const config = getConfig();
    expect(config.hederaOperatorId).toBe("0.0.1001");
    expect(config.port).toBe(Number(process.env.PORT ?? 4021));
  });

  it("getConfig returns same instance on second call (cached)", () => {
    const first = getConfig();
    const second = getConfig();
    expect(first).toBe(second);
  });

  it("getConfig throws on missing required vars", () => {
    delete process.env.HEDERA_OPERATOR_ID;
    resetConfigCache();
    expect(() => getConfig()).toThrow(/HEDERA_OPERATOR_ID/);
  });

  it("getConfig throws aggregated errors for multiple missing vars", () => {
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.PASSPORT_TOKEN_ID;
    resetConfigCache();
    expect(() => getConfig()).toThrow(/HEDERA_OPERATOR_ID/);
    expect(() => getConfig()).toThrow(/PASSPORT_TOKEN_ID/);
  });

  it("loadConfig still works independently (no caching)", () => {
    const config = loadConfig();
    expect(config.hederaOperatorId).toBe("0.0.1001");
    // loadConfig should not cache — calling again should work
    const config2 = loadConfig();
    expect(config2.hederaOperatorId).toBe("0.0.1001");
  });
});
