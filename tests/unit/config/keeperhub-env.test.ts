import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../../../src/config/env";

describe("SLICE-126-9: KeeperHub env config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfigCache();
    // Set required vars for hedera mode (base config)
    process.env.CHAIN_MODE = "hedera";
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
    // Clean keeperhub vars
    delete process.env.KEEPERHUB_ENABLED;
    delete process.env.KEEPERHUB_API_KEY;
    delete process.env.KEEPERHUB_WEBHOOK_KEY;
    delete process.env.KEEPERHUB_SERVER_URL;
    delete process.env.KEEPERHUB_AUDIT_SECRET;
    delete process.env.KEEPERHUB_API_BASE_URL;
    delete process.env.KEEPERHUB_WORKFLOW_RECORD_SCAN;
    delete process.env.KEEPERHUB_WORKFLOW_MINT_PASSPORT;
    delete process.env.KEEPERHUB_WORKFLOW_NOTIFY;
    delete process.env.BASE_TRUST_REGISTRY;
    delete process.env.BASE_TRUST_BADGE;
    delete process.env.BASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it("KEEPERHUB_ENABLED unset → config.keeperhub === undefined", () => {
    const config = loadConfig();
    expect(config.keeperhub).toBeUndefined();
  });

  it("Enabled without KEEPERHUB_API_KEY → throws", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    expect(() => loadConfig()).toThrow(/KEEPERHUB_API_KEY/);
  });

  it("Enabled with wfb_ key → throws kh_ prefix error", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = "wfb_wrong_prefix";
    expect(() => loadConfig()).toThrow(/kh_ prefix/);
  });

  it("Enabled with kh_ key → full section with defaults", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = "kh_test_key";
    const config = loadConfig();
    expect(config.keeperhub).toBeDefined();
    expect(config.keeperhub!.enabled).toBe(true);
    expect(config.keeperhub!.apiKey).toBe("kh_test_key");
    expect(config.keeperhub!.serverUrl).toBe("https://app.keeperhub.com/mcp");
    expect(config.keeperhub!.apiBaseUrl).toBe("https://agentbadge.xyz");
    expect(config.keeperhub!.workflowIds.recordScan).toBeUndefined();
    expect(config.keeperhub!.workflowIds.mintPassport).toBeUndefined();
    expect(config.keeperhub!.workflowIds.notify).toBeUndefined();
  });

  it("Enabled with workflow IDs → populated", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = "kh_test_key";
    process.env.KEEPERHUB_WORKFLOW_RECORD_SCAN = "wf_scan_1";
    process.env.KEEPERHUB_WORKFLOW_MINT_PASSPORT = "wf_mint_2";
    process.env.KEEPERHUB_WORKFLOW_NOTIFY = "wf_notify_3";
    const config = loadConfig();
    expect(config.keeperhub!.workflowIds.recordScan).toBe("wf_scan_1");
    expect(config.keeperhub!.workflowIds.mintPassport).toBe("wf_mint_2");
    expect(config.keeperhub!.workflowIds.notify).toBe("wf_notify_3");
  });

  it("Webhook key with wrong prefix → error", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = "kh_test_key";
    process.env.KEEPERHUB_WEBHOOK_KEY = "kh_wrong_prefix";
    expect(() => loadConfig()).toThrow(/wfb_ prefix/);
  });

  it("Webhook key with wfb_ prefix → accepted", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = "kh_test_key";
    process.env.KEEPERHUB_WEBHOOK_KEY = "wfb_webhook_key";
    const config = loadConfig();
    expect(config.keeperhub!.webhookKey).toBe("wfb_webhook_key");
  });

  it("apiBaseUrl falls back to BASE_URL env", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = "kh_test_key";
    process.env.BASE_URL = "https://custom.example.com";
    const config = loadConfig();
    expect(config.keeperhub!.apiBaseUrl).toBe("https://custom.example.com");
    delete process.env.BASE_URL;
  });

  it("Base mode + BASE_TRUST_REGISTRY → base.trustRegistry set", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_OPERATOR_KEY = "0x" + "a".repeat(64);
    process.env.BASE_PASSPORT_NFT = "0x" + "b".repeat(40);
    process.env.BASE_TASK_ESCROW = "0x" + "c".repeat(40);
    process.env.BASE_USDC_ADDRESS = "0x" + "d".repeat(40);
    process.env.BASE_TRUST_REGISTRY = "0x" + "e".repeat(40);
    process.env.BASE_TRUST_BADGE = "0x" + "f".repeat(40);
    const config = loadConfig();
    expect(config.base?.trustRegistry).toBe("0x" + "e".repeat(40));
    expect(config.base?.trustBadge).toBe("0x" + "f".repeat(40));
  });

  it("Base mode without trust contracts → undefined (no throw)", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_OPERATOR_KEY = "0x" + "a".repeat(64);
    process.env.BASE_PASSPORT_NFT = "0x" + "b".repeat(40);
    process.env.BASE_TASK_ESCROW = "0x" + "c".repeat(40);
    process.env.BASE_USDC_ADDRESS = "0x" + "d".repeat(40);
    const config = loadConfig();
    expect(config.base?.trustRegistry).toBeUndefined();
    expect(config.base?.trustBadge).toBeUndefined();
  });
});
