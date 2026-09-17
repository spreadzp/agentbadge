/**
 * SLICE-129-3: circlePayments env config tests.
 *
 * Verifies feature-gate semantics per D19: master + per-capability flags,
 * all default false; master off = config absent = zero behavior change.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../../src/config/env";

const CIRCLE_VARS = [
  "CIRCLE_PAYMENTS_ENABLED",
  "CIRCLE_GATEWAY_ENABLED",
  "CIRCLE_ARC_ENABLED",
  "CIRCLE_IDENTITY_ENABLED",
  "CIRCLE_ESCROW_ENABLED",
  "CIRCLE_GATEWAY_API_URL",
  "CIRCLE_SELLER_ADDRESS",
  "ARC_RPC_URL",
  "ARC_CHAIN_ID",
  "ARC_PRIVATE_KEY",
];

describe("SLICE-129-3: circlePayments env config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MOCK_HEDERA;
    delete process.env.MOCK_X402;
    delete process.env.MOCK_IPFS;
    delete process.env.CHAIN_MODE;
    delete process.env.KEEPERHUB_ENABLED;
    delete process.env.ATTESTCOIN_ENABLED;
    for (const v of CIRCLE_VARS) delete process.env[v];
    resetConfigCache();
    // Set required vars for valid base config
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

  it("circlePayments is undefined when CIRCLE_PAYMENTS_ENABLED unset", () => {
    const config = loadConfig();
    expect(config.circlePayments).toBeUndefined();
  });

  it("circlePayments is undefined when CIRCLE_PAYMENTS_ENABLED=false", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "false";
    const config = loadConfig();
    expect(config.circlePayments).toBeUndefined();
  });

  it("master on requires CIRCLE_SELLER_ADDRESS", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    expect(() => loadConfig()).toThrow(/CIRCLE_SELLER_ADDRESS/);
  });

  it("master on with seller address: all capability flags default false", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    const config = loadConfig();
    expect(config.circlePayments).toBeDefined();
    expect(config.circlePayments!.enabled).toBe(true);
    expect(config.circlePayments!.gateway).toBe(false);
    expect(config.circlePayments!.arc).toBe(false);
    expect(config.circlePayments!.identity).toBe(false);
    expect(config.circlePayments!.escrow).toBe(false);
  });

  it("defaults: gateway api url, arc rpc, arc chain id", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    const config = loadConfig();
    expect(config.circlePayments!.gatewayApiUrl).toBe(
      "https://gateway-api-testnet.circle.com",
    );
    expect(config.circlePayments!.arcRpcUrl).toBe(
      "https://rpc.testnet.arc.network",
    );
    expect(config.circlePayments!.arcChainId).toBe(5042002);
  });

  it("per-capability flags parse independently", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    process.env.CIRCLE_GATEWAY_ENABLED = "true";
    process.env.CIRCLE_IDENTITY_ENABLED = "true";
    const config = loadConfig();
    expect(config.circlePayments!.gateway).toBe(true);
    expect(config.circlePayments!.identity).toBe(true);
    expect(config.circlePayments!.arc).toBe(false);
    expect(config.circlePayments!.escrow).toBe(false);
  });

  it("arc enabled requires ARC_PRIVATE_KEY", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    process.env.CIRCLE_ARC_ENABLED = "true";
    expect(() => loadConfig()).toThrow(/ARC_PRIVATE_KEY/);
  });

  it("escrow enabled requires ARC_PRIVATE_KEY", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    process.env.CIRCLE_ESCROW_ENABLED = "true";
    expect(() => loadConfig()).toThrow(/ARC_PRIVATE_KEY/);
  });

  it("arc enabled with key loads full config", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    process.env.CIRCLE_ARC_ENABLED = "true";
    process.env.ARC_PRIVATE_KEY = "0xabc123";
    process.env.ARC_RPC_URL = "https://rpc.testnet.arc.io";
    const config = loadConfig();
    expect(config.circlePayments!.arc).toBe(true);
    expect(config.circlePayments!.arcPrivateKey).toBe("0xabc123");
    expect(config.circlePayments!.arcRpcUrl).toBe(
      "https://rpc.testnet.arc.io",
    );
  });

  it("invalid seller address rejected", () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS = "not-an-address";
    expect(() => loadConfig()).toThrow(/CIRCLE_SELLER_ADDRESS/);
  });
});
