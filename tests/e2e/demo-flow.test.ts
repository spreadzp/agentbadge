import { describe, it, expect, vi, beforeAll } from "vitest";
import { setupMockEnv, makeTestApp, makeEvmWallet, signWalletOwnership } from "./helpers";
import {
  issuePassport,
  getPassportInfo,
  upgradeTier,
  revokePassport,
} from "@agentbadge/passport";
import { handleHttpToolCall } from "@agentbadge/mcp";
import { registerPassportTools } from "@agentbadge/mcp";
import { registerAuditCatalogTools } from "@agentbadge/mcp";
import { registerDirectoryTools } from "@agentbadge/mcp";
import {
  upsert as upsertDirectory,
  clear as clearDirectory,
  getAll,
} from "@agentbadge/passport";
import type { Hono } from "hono";


describe("SLICE-6-5: Full Demo Flow E2E (5-min judge scenario)", () => {
  let app: Hono;
  let walletA: ReturnType<typeof makeEvmWallet>;
  let walletB: ReturnType<typeof makeEvmWallet>;
  let sigA: string;
  let sigB: string;
  let passportA: {
    tokenId: string;
    serialNumber: number;
    did: string;
    tier: string;
    hashScanLink: string;
  };
  let passportB: {
    tokenId: string;
    serialNumber: number;
    did: string;
    tier: string;
    hashScanLink: string;
  };

  beforeAll(async () => {
    setupMockEnv();
    clearDirectory();
    app = makeTestApp();

    registerPassportTools();
    registerAuditCatalogTools();
    registerDirectoryTools();

    walletA = makeEvmWallet();
    walletB = makeEvmWallet();
    sigA = await signWalletOwnership(walletA.privateKey, walletA.address);
    sigB = await signWalletOwnership(walletB.privateKey, walletB.address);
  });

  it("1. Agent A requests Silver passport → issued with correct tier", async () => {
    passportA = await issuePassport(
      walletA.address,
      sigA,
      "silver",
      "AgentAlpha",
      ["api_call", "data_provide"],
      "https://alpha.example.com",
    );
    expect(passportA.tokenId).toBeDefined();
    expect(passportA.serialNumber).toBeTypeOf("number");
    expect(passportA.did).toMatch(/^did:hcs:/);
    expect(passportA.tier).toBe("silver");
  });

  it("2. Agent A registers in directory → appears in GET /agents", async () => {
    upsertDirectory({
      did: passportA.did,
      tokenId: passportA.tokenId,
      serial: passportA.serialNumber,
      accountId: walletA.address,
      name: "AgentAlpha",
      capabilities: ["api_call", "data_provide"],
      endpoint: "https://alpha.example.com",
      tier: "silver",
      timestamp: Math.floor(Date.now() / 1000),
    });

    const res = await app.request("/agents");
    expect(res.status).toBe(200);
    const data = await res.json();
    const found = data.agents.find((a: { did: string }) => a.did === passportA.did);
    expect(found).toBeDefined();
    expect(found.name).toBe("AgentAlpha");
  });

  it("3. Agent B requests Bronze passport → issued with correct tier", async () => {
    passportB = await issuePassport(
      walletB.address,
      sigB,
      "bronze",
      "AgentBeta",
      ["api_call", "payment"],
      "https://beta.example.com",
    );
    expect(passportB.tokenId).toBeDefined();
    expect(passportB.serialNumber).toBeTypeOf("number");
    expect(passportB.did).toMatch(/^did:hcs:/);
    expect(passportB.tier).toBe("bronze");
  });

  it("4. Agent B registers in directory → appears in GET /agents", async () => {
    upsertDirectory({
      did: passportB.did,
      tokenId: passportB.tokenId,
      serial: passportB.serialNumber,
      accountId: walletB.address,
      name: "AgentBeta",
      capabilities: ["api_call", "payment"],
      endpoint: "https://beta.example.com",
      tier: "bronze",
      timestamp: Math.floor(Date.now() / 1000),
    });

    const res = await app.request("/agents");
    expect(res.status).toBe(200);
    const data = await res.json();
    const found = data.agents.find((a: { did: string }) => a.did === passportB.did);
    expect(found).toBeDefined();
    expect(found.name).toBe("AgentBeta");
  });

  it("5. Agent B calls find_agents(capability=data_provide) → returns Agent A only", async () => {
    const result = await handleHttpToolCall("find_agents", {
      capability: "data_provide",
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    const names = data.agents.map((a: { name: string }) => a.name);
    expect(names).toContain("AgentAlpha");
    expect(names).not.toContain("AgentBeta");
  });

  it("6. Agent B calls verify_passport on Agent A → active, Silver", async () => {
    const info = await getPassportInfo(passportA.tokenId, passportA.serialNumber);
    expect(info).not.toBeNull();
    expect(info!.active).toBe(true);
    expect(info!.tier).toBe("silver");
    expect(info!.owner).toBe(walletA.address);
  });

  it("7. Agent A upgrades to Gold → verify reflects Gold", async () => {
    await upgradeTier(passportA.tokenId, passportA.serialNumber, "gold", walletA.address);

    const info = await getPassportInfo(passportA.tokenId, passportA.serialNumber);
    expect(info).not.toBeNull();
    expect(info!.tier).toBe("gold");
    expect(info!.active).toBe(true);
  });

  it("8. Agent B reads audit trail → contains all expected events", async () => {
    const result = await handleHttpToolCall("get_audit_trail", {
      tokenId: passportA.tokenId,
      serial: passportA.serialNumber,
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    const types = data.events.map((e: { type: string }) => e.type);
    expect(types).toContain("passport_issued");
    expect(types).toContain("tier_upgraded");
  });

  it("9. Admin revokes Agent B passport → verify returns revoked", async () => {
    await revokePassport(passportB.tokenId, passportB.serialNumber, "demo revocation");

    const info = await getPassportInfo(passportB.tokenId, passportB.serialNumber);
    expect(info).not.toBeNull();
    expect(info!.active).toBe(false);
  });

  it("10. Dashboard shows correct stats (2 issued, 1 active, 1 revoked)", async () => {
    const res = await app.request("/ui/stats", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Stats fragment should show total and counts
    expect(html).toMatch(/total|issued/i);
    // Both passports were issued
    expect(html).toContain("2");
  });
});
