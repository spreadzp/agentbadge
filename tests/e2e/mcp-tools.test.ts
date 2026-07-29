import { describe, it, expect, vi, beforeAll } from "vitest";


import { setupMockEnv, makeEvmWallet, signWalletOwnership } from "./helpers";
import { handleHttpToolCall } from "@agentgate-hedera/mcp";
import { registerPassportTools } from "@agentgate-hedera/mcp";
import { registerAuditCatalogTools, getAuditTrail } from "@agentgate-hedera/mcp";
import { registerDirectoryTools } from "@agentgate-hedera/mcp";
import { clear as clearDirectoryCache } from "@agentgate-hedera/passport";

describe("SLICE-6-3: MCP Tools Integration E2E", () => {
  let wallet: ReturnType<typeof makeEvmWallet>;
  let signature: string;
  let issuedTokenId: string;
  let issuedSerial: number;
  let issuedDid: string;

  beforeAll(async () => {
    setupMockEnv();
    clearDirectoryCache();
    registerPassportTools();
    registerAuditCatalogTools();
    registerDirectoryTools();

    wallet = makeEvmWallet();
    signature = await signWalletOwnership(wallet.privateKey, wallet.address);
  });

  it("1. get_tier_requirements → catalog with 4 tiers", async () => {
    const result = await handleHttpToolCall("get_tier_requirements", {});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.tiers).toBeDefined();
    expect(Object.keys(data.tiers)).toHaveLength(4);
  });

  it("2. request_passport → issues passport (tokenId, serial, did)", async () => {
    const result = await handleHttpToolCall("request_passport", {
      accountId: wallet.address,
      signature,
      tier: "silver",
      name: "McpTestBot",
      capabilities: ["api_call", "data_provide"],
      endpoint: "https://mcp-agent.example.com",
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.tokenId).toBeDefined();
    expect(data.serialNumber).toBeTypeOf("number");
    expect(data.did).toMatch(/^did:hcs:/);
    expect(data.tier).toBe("silver");

    issuedTokenId = data.tokenId;
    issuedSerial = data.serialNumber;
    issuedDid = data.did;
  });

  it("3. verify_passport → confirms passport (status: active)", async () => {
    const result = await handleHttpToolCall("verify_passport", {
      tokenId: issuedTokenId,
      serial: issuedSerial,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.active).toBe(true);
    expect(data.tier).toBe("silver");
    expect(data.did).toBe(issuedDid);
  });

  it("4. get_passport → returns metadata (tier, capabilities)", async () => {
    const result = await handleHttpToolCall("get_passport", {
      tokenId: issuedTokenId,
      serial: issuedSerial,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.tier).toBe("silver");
    expect(data.capabilities).toEqual(["api_call", "data_provide"]);
    expect(data.did).toBe(issuedDid);
    expect(data.owner).toBe(wallet.address);
  });

  it("5. list_passports → returns array including issued passport", async () => {
    const result = await handleHttpToolCall("list_passports", {});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.passports).toBeDefined();
    expect(Array.isArray(data.passports)).toBe(true);
    const found = data.passports.find(
      (p: { serialNumber: number }) => p.serialNumber === issuedSerial,
    );
    expect(found).toBeDefined();
  });

  it("6. upgrade_tier → upgrades tier (returns new tier)", async () => {
    const result = await handleHttpToolCall("upgrade_tier", {
      tokenId: issuedTokenId,
      serial: issuedSerial,
      newTier: "gold",
      accountId: wallet.address,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.tier).toBe("gold");
  });

  it("7. register_agent → registers agent in directory", async () => {
    const result = await handleHttpToolCall("register_agent", {
      did: issuedDid,
      tokenId: issuedTokenId,
      serial: issuedSerial,
      accountId: wallet.address,
      name: "McpTestBot",
      capabilities: ["api_call", "data_provide"],
      endpoint: "https://mcp-agent.example.com",
      tier: "gold",
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.registered).toBe(true);
  });

  it("8. find_agents → returns agents matching capability filter", async () => {
    const result = await handleHttpToolCall("find_agents", {
      capability: "data_provide",
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.agents).toBeDefined();
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThanOrEqual(1);
    expect(
      data.agents.every((a: { capabilities: string[] }) => a.capabilities.includes("data_provide")),
    ).toBe(true);
  });

  it("9. get_audit_trail → returns audit messages for the passport", async () => {
    const result = await handleHttpToolCall("get_audit_trail", {
      tokenId: issuedTokenId,
      serial: issuedSerial,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.events).toBeDefined();
    expect(Array.isArray(data.events)).toBe(true);
    const types = data.events.map((e: { type: string }) => e.type);
    expect(types).toContain("passport_issued");
    expect(types).toContain("tier_upgraded");
    expect(types).toContain("agent_registered");
  });
});
