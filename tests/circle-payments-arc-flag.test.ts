/**
 * SLICE-200-01 F6: supported_networks `arc` capability flag.
 *
 * The flag must reflect the real Arc self-settle capability —
 * `config.arc || Boolean(runtime.arcSelfSettle)` — not just the
 * static env flag. Covered via wireCirclePayments → marketNs
 * supported_networks tool call.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createNamespace, type NamespaceRegistry } from "@agentbadge/mcp";
import { wireCirclePayments } from "../src/server/wiring/circle-payments";
import { loadConfig, resetConfigCache } from "../src/config/env";

const SELLER = "0x1111111111111111111111111111111111111111";
const ARC_KEY = `0x${"a".repeat(64)}`;

const CIRCLE_VARS = [
  "CIRCLE_PAYMENTS_ENABLED",
  "CIRCLE_GATEWAY_ENABLED",
  "CIRCLE_ARC_ENABLED",
  "CIRCLE_IDENTITY_ENABLED",
  "CIRCLE_ESCROW_ENABLED",
  "CIRCLE_SELLER_ADDRESS",
  "ARC_PRIVATE_KEY",
  "ARC_RPC_URL",
  "ARC_CHAIN_ID",
];

function baseEnv() {
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
}

async function callSupportedNetworks(marketNs: NamespaceRegistry) {
  const result = await marketNs.handleHttpToolCall("supported_networks", {});
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text) as {
    capabilities: { gateway: boolean; arc: boolean; identity: boolean; escrow: boolean };
  };
}

describe("SLICE-200-01 F6: supported_networks arc flag", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const v of CIRCLE_VARS) delete process.env[v];
    baseEnv();
    resetConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it("arc=false in config and no arcSelfSettle → capabilities.arc is false", async () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS = SELLER;
    loadConfig();

    const app = new Hono();
    const marketNs = createNamespace("test-arc-off");
    wireCirclePayments(app, { marketNs });

    const body = await callSupportedNetworks(marketNs);
    expect(body.capabilities.arc).toBe(false);
  });

  it("arc config on → real arcSelfSettle handle exists → capabilities.arc is true", async () => {
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS = SELLER;
    process.env.CIRCLE_ARC_ENABLED = "true";
    process.env.ARC_PRIVATE_KEY = ARC_KEY;
    loadConfig();

    const app = new Hono();
    const marketNs = createNamespace("test-arc-on");
    const rt = wireCirclePayments(app, { marketNs });

    expect(rt?.arcSelfSettle).toBeDefined();
    const body = await callSupportedNetworks(marketNs);
    expect(body.capabilities.arc).toBe(true);
  });
});
