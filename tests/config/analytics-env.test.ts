/**
 * SLICE-130-5: Analytics env config tests.
 *
 * Verifies that analytics config is loaded correctly with feature-gate semantics:
 * unset/false = zero behavior change.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../../src/config/env";

describe("SLICE-130-5: Analytics env config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MOCK_HEDERA;
    delete process.env.MOCK_X402;
    delete process.env.MOCK_IPFS;
    delete process.env.CHAIN_MODE;
    delete process.env.GA4_ENABLED;
    delete process.env.GA4_MEASUREMENT_ID;
    delete process.env.GA4_API_SECRET;
    delete process.env.PLAUSIBLE_ENABLED;
    delete process.env.PLAUSIBLE_DOMAIN;
    delete process.env.GOOGLE_SITE_VERIFICATION;
    delete process.env.KEEPERHUB_ENABLED;
    delete process.env.ATTESTCOIN_ENABLED;
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

  it("analytics config exists with all fields", () => {
    const config = loadConfig();
    expect(config.analytics).toBeDefined();
    expect(config.analytics.ga4Enabled).toBe(false);
    expect(config.analytics.ga4MeasurementId).toBeUndefined();
    expect(config.analytics.ga4ApiSecret).toBeUndefined();
    expect(config.analytics.plausibleEnabled).toBe(false);
    expect(config.analytics.plausibleDomain).toBeUndefined();
    expect(config.analytics.gscVerification).toBeUndefined();
  });

  it("GA4_ENABLED=true enables GA4", () => {
    process.env.GA4_ENABLED = "true";
    process.env.GA4_MEASUREMENT_ID = "G-TEST123456";
    process.env.GA4_API_SECRET = "secret123";
    const config = loadConfig();
    expect(config.analytics.ga4Enabled).toBe(true);
    expect(config.analytics.ga4MeasurementId).toBe("G-TEST123456");
    expect(config.analytics.ga4ApiSecret).toBe("secret123");
  });

  it("GA4_ENABLED=false (default) disables GA4 even if other vars set", () => {
    process.env.GA4_ENABLED = "false";
    process.env.GA4_MEASUREMENT_ID = "G-TEST123456";
    const config = loadConfig();
    expect(config.analytics.ga4Enabled).toBe(false);
    expect(config.analytics.ga4MeasurementId).toBe("G-TEST123456");
  });

  it("PLAUSIBLE_ENABLED=true enables Plausible", () => {
    process.env.PLAUSIBLE_ENABLED = "true";
    process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
    const config = loadConfig();
    expect(config.analytics.plausibleEnabled).toBe(true);
    expect(config.analytics.plausibleDomain).toBe("agentbadge.xyz");
  });

  it("GSC verification content is read from env", () => {
    process.env.GOOGLE_SITE_VERIFICATION = "abc123verify";
    const config = loadConfig();
    expect(config.analytics.gscVerification).toBe("abc123verify");
  });

  it("server starts fine with no analytics env vars set", () => {
    delete process.env.GA4_ENABLED;
    delete process.env.GA4_MEASUREMENT_ID;
    delete process.env.GA4_API_SECRET;
    delete process.env.PLAUSIBLE_ENABLED;
    delete process.env.PLAUSIBLE_DOMAIN;
    delete process.env.GOOGLE_SITE_VERIFICATION;
    const config = loadConfig();
    expect(config.analytics.ga4Enabled).toBe(false);
    expect(config.analytics.plausibleEnabled).toBe(false);
    expect(config.analytics.gscVerification).toBeUndefined();
  });
});
