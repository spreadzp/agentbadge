import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";


import { setupMockEnv, makeTestApp, makeEvmWallet, signWalletOwnership } from "./helpers";
import { clear as clearDirectoryCache } from "@agentgate-hedera/passport";
import { rebuildFromHcs } from "@agentgate-hedera/passport";
import { submitDirectoryMessage } from "@agentgate-hedera/hedera-core";

describe("SLICE-6-2: Agent Directory E2E", () => {
  let app: ReturnType<typeof makeTestApp>;
  let wallet: ReturnType<typeof makeEvmWallet>;
  let signature: string;
  let issuedTokenId: string;
  let issuedSerial: number;
  let issuedDid: string;

  beforeAll(async () => {
    setupMockEnv();
    app = makeTestApp();
    wallet = makeEvmWallet();
    signature = await signWalletOwnership(wallet.privateKey, wallet.address);

    // Issue a passport first so NFT exists in mock store
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: wallet.address,
        signature,
        tier: "silver",
        name: "DirectoryBot",
        capabilities: ["api_call", "data_provide"],
        endpoint: "https://agent.example.com",
      }),
    });
    const body = await res.json();
    issuedTokenId = body.tokenId;
    issuedSerial = body.serialNumber;
    issuedDid = body.did;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockEnv();
    clearDirectoryCache();
  });

  it("1. POST /agents/register with valid DID → 200, agent in directory", async () => {
    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        did: issuedDid,
        tokenId: issuedTokenId,
        serial: issuedSerial,
        accountId: wallet.address,
        name: "DirectoryBot",
        capabilities: ["api_call", "data_provide"],
        endpoint: "https://agent.example.com",
        tier: "silver",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);

    // Verify agent appears in directory
    const listRes = await app.request("/agents");
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const found = listBody.agents.find((a: { did: string }) => a.did === issuedDid);
    expect(found).toBeDefined();
    expect(found.name).toBe("DirectoryBot");
  });

  it("2. GET /agents?capability=data_provide → only agents with that capability", async () => {
    // Register agent first
    await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        did: issuedDid,
        tokenId: issuedTokenId,
        serial: issuedSerial,
        accountId: wallet.address,
        name: "DirectoryBot",
        capabilities: ["api_call", "data_provide"],
        endpoint: "https://agent.example.com",
        tier: "silver",
      }),
    });

    const res = await app.request("/agents?capability=data_provide");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents.length).toBeGreaterThanOrEqual(1);
    expect(
      body.agents.every((a: { capabilities: string[] }) => a.capabilities.includes("data_provide")),
    ).toBe(true);
  });

  it("3. GET /agents/:did → single agent entry with correct fields", async () => {
    // Register agent first
    await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        did: issuedDid,
        tokenId: issuedTokenId,
        serial: issuedSerial,
        accountId: wallet.address,
        name: "DirectoryBot",
        capabilities: ["api_call", "data_provide"],
        endpoint: "https://agent.example.com",
        tier: "silver",
      }),
    });

    const res = await app.request(`/agents/${encodeURIComponent(issuedDid)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent).toBeDefined();
    expect(body.agent.did).toBe(issuedDid);
    expect(body.agent.name).toBe("DirectoryBot");
    expect(body.agent.tier).toBe("silver");
    expect(body.agent.capabilities).toEqual(["api_call", "data_provide"]);
    expect(body.agent.active).toBe(true);
  });

  it("4. Register two agents with different capabilities, filtering returns correct subset", async () => {
    // First agent already has a passport — register it
    await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        did: issuedDid,
        tokenId: issuedTokenId,
        serial: issuedSerial,
        accountId: wallet.address,
        name: "DirectoryBot",
        capabilities: ["api_call", "data_provide"],
        endpoint: "https://agent1.example.com",
        tier: "silver",
      }),
    });

    // Issue a second passport for a second agent
    const wallet2 = makeEvmWallet();
    const sig2 = await signWalletOwnership(wallet2.privateKey, wallet2.address);
    const res2 = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: wallet2.address,
        signature: sig2,
        tier: "gold",
        name: "PaymentBot",
        capabilities: ["payment", "orchestration"],
        endpoint: "https://agent2.example.com",
      }),
    });
    const body2 = await res2.json();
    const did2 = body2.did;
    const tokenId2 = body2.tokenId;
    const serial2 = body2.serialNumber;

    await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        did: did2,
        tokenId: tokenId2,
        serial: serial2,
        accountId: wallet2.address,
        name: "PaymentBot",
        capabilities: ["payment", "orchestration"],
        endpoint: "https://agent2.example.com",
        tier: "gold",
      }),
    });

    // Filter by payment capability
    const payRes = await app.request("/agents?capability=payment");
    expect(payRes.status).toBe(200);
    const payBody = await payRes.json();
    expect(payBody.agents.length).toBeGreaterThanOrEqual(1);
    const payNames = payBody.agents.map((a: { name: string }) => a.name);
    expect(payNames).toContain("PaymentBot");
    expect(payNames).not.toContain("DirectoryBot");

    // Filter by data_provide capability
    const dataRes = await app.request("/agents?capability=data_provide");
    expect(dataRes.status).toBe(200);
    const dataBody = await dataRes.json();
    const dataNames = dataBody.agents.map((a: { name: string }) => a.name);
    expect(dataNames).toContain("DirectoryBot");
    expect(dataNames).not.toContain("PaymentBot");
  });

  it("5. Directory cache rebuilds from HCS topic messages", async () => {
    // Submit a directory message directly to mock HCS
    const dirMessage = {
      type: "agent_register" as const,
      did: "did:hcs:0.0.999:1",
      tokenId: "0.0.999",
      serial: 1,
      accountId: "0.0.456",
      name: "RebuiltBot",
      capabilities: ["api_call"],
      endpoint: "https://rebuilt.example.com",
      tier: "bronze",
      timestamp: Math.floor(Date.now() / 1000),
    };
    await submitDirectoryMessage(dirMessage);

    // Cache should be empty before rebuild
    const emptyRes = await app.request("/agents");
    const emptyBody = await emptyRes.json();
    expect(emptyBody).toHaveProperty("agents");
    expect(emptyBody.agents).toHaveLength(0);

    // Rebuild from HCS
    const topicId = process.env.DIRECTORY_TOPIC_ID!;
    await rebuildFromHcs(topicId);

    // Verify agent appears after rebuild
    const res = await app.request("/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.agents.find((a: { did: string }) => a.did === "did:hcs:0.0.999:1");
    expect(found).toBeDefined();
    expect(found.name).toBe("RebuiltBot");
  });
});
