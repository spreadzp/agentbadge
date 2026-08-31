/**
 * SLICE-7-15: Integration Tests — Full End-to-End Flows
 *
 * Verifies that all EPIC-7 hardening features (CORS, rate limiting, admin auth,
 * endpoint validation, structured logging, request logging) work correctly
 * when the full pipeline is exercised:
 *
 * AC#1: Passport lifecycle (issue → verify → upgrade → revoke)
 * AC#2: Agent discovery flow (register → find → verify)
 * AC#3: MCP tools end-to-end via HTTP transport
 * AC#4: Audit trail contains all expected events
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { Hono } from "hono";

import { setupMockEnv, makeTestApp, makeEvmWallet, signWalletOwnership } from "./helpers";
import { clear as clearDirectoryCache } from "@agentbadge/passport";
import { registerPassportTools, registerAuditCatalogTools, registerDirectoryTools } from "@agentbadge/mcp";

describe("SLICE-7-15: Integration Tests — Full E2E Flows", () => {
  let app: Hono;
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
    app = makeTestApp();
    wallet = makeEvmWallet();
    signature = await signWalletOwnership(wallet.privateKey, wallet.address);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockEnv();
  });

  afterAll(() => {
    clearDirectoryCache();
  });

  // ─── AC#1: Passport Lifecycle ─────────────────────────────────────

  describe("AC#1: Passport lifecycle (issue → verify → upgrade → revoke)", () => {
    it("issues a passport via POST /passport/request", async () => {
      const res = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: wallet.address,
          signature,
          tier: "bronze",
          name: "IntegrationBot",
          capabilities: ["api_call", "data_provide", "payment"],
          endpoint: "https://integration-agent.example.com",
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      const body = await res.json();
      expect(body.tokenId).toBeDefined();
      expect(body.serialNumber).toBeTypeOf("number");
      expect(body.did).toMatch(/^did:hcs:/);
      expect(body.tier).toBe("bronze");

      issuedTokenId = body.tokenId;
      issuedSerial = body.serialNumber;
      issuedDid = body.did;
    });

    it("verifies the passport via GET /passport/:tokenId/:serial", async () => {
      const res = await app.request(`/passport/${issuedTokenId}/${issuedSerial}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tier).toBe("bronze");
      expect(body.active).toBe(true);
      expect(body.did).toBe(issuedDid);
      expect(body.owner).toBe(wallet.address);
    });

    it("upgrades the passport via POST /passport/:tokenId/:serial/upgrade", async () => {
      const res = await app.request(`/passport/${issuedTokenId}/${issuedSerial}/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newTier: "gold",
          accountId: wallet.address,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tier).toBe("gold");
      expect(body.tokenId).toBe(issuedTokenId);
      expect(body.serialNumber).toBe(issuedSerial);
    });

    it("confirms upgraded tier via GET /passport/:tokenId/:serial", async () => {
      const res = await app.request(`/passport/${issuedTokenId}/${issuedSerial}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tier).toBe("gold");
      expect(body.active).toBe(true);
    });

    it("revokes the passport via POST /admin/revoke with Bearer auth", async () => {
      const res = await app.request("/admin/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-admin-key",
        },
        body: JSON.stringify({
          tokenId: issuedTokenId,
          serial: issuedSerial,
          reason: "Integration test revocation",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("confirms revoked status (active=false)", async () => {
      const res = await app.request(`/passport/${issuedTokenId}/${issuedSerial}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.active).toBe(false);
    });
  });

  // ─── AC#2: Agent Discovery Flow ───────────────────────────────────

  describe("AC#2: Agent discovery (register → find → verify)", () => {
    let discoveryWallet: ReturnType<typeof makeEvmWallet>;
    let discoveryDid: string;
    let discoveryTokenId: string;
    let discoverySerial: number;

    it("issues a passport for the discovery agent", async () => {
      discoveryWallet = makeEvmWallet();
      const sig = await signWalletOwnership(discoveryWallet.privateKey, discoveryWallet.address);
      const res = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: discoveryWallet.address,
          signature: sig,
          tier: "silver",
          name: "DiscoveryAgent",
          capabilities: ["api_call", "data_provide"],
          endpoint: "https://discovery-agent.example.com",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      discoveryDid = body.did;
      discoveryTokenId = body.tokenId;
      discoverySerial = body.serialNumber;
    });

    it("registers the agent via POST /agents/register", async () => {
      const res = await app.request("/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          did: discoveryDid,
          tokenId: discoveryTokenId,
          serial: discoverySerial,
          accountId: discoveryWallet.address,
          name: "DiscoveryAgent",
          capabilities: ["api_call", "data_provide"],
          endpoint: "https://discovery-agent.example.com",
          tier: "silver",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.registered).toBe(true);
    });

    it("finds the agent via GET /agents?capability=data_provide", async () => {
      const res = await app.request("/agents?capability=data_provide");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agents).toBeInstanceOf(Array);
      const found = body.agents.find((a: { did: string }) => a.did === discoveryDid);
      expect(found).toBeDefined();
    });

    it("verifies the agent via GET /agents/:did", async () => {
      const res = await app.request(`/agents/${discoveryDid}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agent).toBeDefined();
      expect(body.agent.did).toBe(discoveryDid);
      expect(body.agent.name).toBe("DiscoveryAgent");
    });
  });

  // ─── AC#3: MCP Tools End-to-End via HTTP Transport ────────────────

  describe("AC#3: MCP tools end-to-end via HTTP transport", () => {
    it("GET /mcp/tools → 200 with tool list", async () => {
      const res = await app.request("/mcp/tools");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools).toBeInstanceOf(Array);
      expect(body.tools.length).toBeGreaterThan(0);
    });

    it("POST /mcp/tools/get_tier_requirements → 200 with tier catalog", async () => {
      const res = await app.request("/mcp/tools/get_tier_requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isError).toBeFalsy();
      const data = JSON.parse(body.content[0].text);
      expect(data.tiers).toBeDefined();
      expect(Object.keys(data.tiers).length).toBeGreaterThanOrEqual(4);
    });

    it("POST /mcp/tools/verify_passport → 200 with passport status", async () => {
      const res = await app.request("/mcp/tools/verify_passport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: issuedTokenId,
          serial: issuedSerial,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isError).toBeFalsy();
      const data = JSON.parse(body.content[0].text);
      expect(data.did).toBe(issuedDid);
      // Passport was revoked in AC#1
      expect(data.active).toBe(false);
    });

    it("POST /mcp/tools/get_audit_trail → 200 with audit events", async () => {
      const res = await app.request("/mcp/tools/get_audit_trail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: issuedTokenId,
          serial: issuedSerial,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isError).toBeFalsy();
      const data = JSON.parse(body.content[0].text);
      expect(data.events).toBeInstanceOf(Array);
      expect(data.events.length).toBeGreaterThan(0);
    });

    it("POST /mcp/tools/find_agents → 200 with agent results", async () => {
      const res = await app.request("/mcp/tools/find_agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: "data_provide" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isError).toBeFalsy();
      const data = JSON.parse(body.content[0].text);
      expect(data.agents).toBeInstanceOf(Array);
    });
  });

  // ─── AC#4: Audit Trail Contains All Expected Events ───────────────

  describe("AC#4: Audit trail contains all expected events", () => {
    it("GET /audit/:tokenId/:serial → contains issued, upgraded, revoked events", async () => {
      const res = await app.request(`/audit/${issuedTokenId}/${issuedSerial}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeInstanceOf(Array);
      expect(body.events.length).toBeGreaterThanOrEqual(3);

      const types = body.events.map((e: { type: string }) => e.type);
      expect(types).toContain("passport_issued");
      expect(types).toContain("tier_upgraded");
      expect(types).toContain("passport_revoked");
    });

    it("audit events have required fields (type, timestamp, tokenId, serial)", async () => {
      const res = await app.request(`/audit/${issuedTokenId}/${issuedSerial}`);
      const body = await res.json();
      for (const event of body.events) {
        expect(event.type).toBeTypeOf("string");
        expect(event.timestamp).toBeDefined();
        expect(event.tokenId).toBe(issuedTokenId);
        expect(event.serial).toBe(issuedSerial);
      }
    });

    it("CORS headers present on audit endpoint", async () => {
      const res = await app.request(`/audit/${issuedTokenId}/${issuedSerial}`);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  // ─── Cross-Cutting: EPIC-7 Middleware in Full Pipeline ────────────

  describe("Cross-cutting: EPIC-7 middleware verification", () => {
    it("CORS headers present on all pipeline endpoints", async () => {
      const endpoints = ["/catalog", "/agents", "/mcp/tools"];
      for (const ep of endpoints) {
        const res = await app.request(ep);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      }
    });

    it("admin endpoint requires authentication in full pipeline", async () => {
      const res = await app.request("/admin/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId: "0.0.123",
          serial: 1,
          reason: "should fail",
        }),
      });
      expect(res.status).toBe(401);
    });

    it("invalid agent endpoint rejected in full pipeline", async () => {
      const res = await app.request("/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          did: "did:hcs:0.0.123:1",
          tokenId: "0.0.123",
          serial: 1,
          accountId: "0x0",
          name: "BadBot",
          capabilities: ["api_call"],
          endpoint: "file:///etc/passwd",
          tier: "bronze",
        }),
      });
      expect(res.status).toBe(400);
    });
  });
});
