/**
 * E2E tests for EPIC-7 security hardening features.
 *
 * Verifies that middleware added in EPIC-7 works correctly in the full
 * e2e test app context (corsMiddleware, rateLimitMiddleware, adminAuth,
 * endpoint validation).
 *
 * References:
 * - SLICE-7-3: Rate limiting on POST /mcp/tools/:name
 * - SLICE-7-11: Admin auth (X-Admin-Key + Authorization: Bearer)
 * - SLICE-7-12: CORS middleware
 * - SLICE-7-13: Endpoint URL validation in POST /agents/register
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

import { setupMockEnv, makeTestApp, makeEvmWallet, signWalletOwnership } from "./helpers";
import { clear as clearDirectoryCache } from "@agentbadge/passport";
import type { Hono } from "hono";

describe("EPIC-7: Security Hardening E2E", () => {
  let app: Hono;
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

    // Issue a passport for agent registration tests
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: wallet.address,
        signature,
        tier: "silver",
        name: "HardeningBot",
        capabilities: ["api_call"],
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

  // -------------------------------------------------------------------------
  // SLICE-7-12: CORS middleware
  // -------------------------------------------------------------------------
  describe("SLICE-7-12: CORS middleware", () => {
    it("GET /catalog includes Access-Control-Allow-Origin: * by default", async () => {
      const res = await app.request("/catalog");
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("OPTIONS preflight returns 204 with CORS headers", async () => {
      const res = await app.request("/passport/request", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });

    it("CORS headers present on GET /agents", async () => {
      const res = await app.request("/agents");
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  // -------------------------------------------------------------------------
  // SLICE-7-11: Admin auth (Authorization: Bearer)
  // -------------------------------------------------------------------------
  describe("SLICE-7-11: Admin auth via Authorization: Bearer", () => {
    it("POST /admin/revoke with valid Bearer token → 200", async () => {
      const res = await app.request("/admin/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-admin-key",
        },
        body: JSON.stringify({
          tokenId: issuedTokenId,
          serial: issuedSerial,
          reason: "E2E Bearer auth test",
        }),
      });
      expect(res.status).toBe(200);
    });

    it("POST /admin/revoke without auth → 401", async () => {
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

    it("POST /admin/revoke with wrong Bearer token → 401", async () => {
      const res = await app.request("/admin/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({
          tokenId: "0.0.123",
          serial: 1,
          reason: "should fail",
        }),
      });
      expect(res.status).toBe(401);
    });

    it("POST /admin/revoke with X-Admin-Key still works (backward compat)", async () => {
      // Re-issue a passport since the previous one was revoked
      const wallet2 = makeEvmWallet();
      const sig2 = await signWalletOwnership(wallet2.privateKey, wallet2.address);
      const issueRes = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: wallet2.address,
          signature: sig2,
          tier: "bronze",
          name: "BackwardCompatBot",
          capabilities: ["api_call"],
          endpoint: "https://agent.example.com",
        }),
      });
      const issueBody = await issueRes.json();

      const res = await app.request("/admin/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": "test-admin-key",
        },
        body: JSON.stringify({
          tokenId: issueBody.tokenId,
          serial: issueBody.serialNumber,
          reason: "Backward compat test",
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // SLICE-7-13: Endpoint URL validation
  // -------------------------------------------------------------------------
  describe("SLICE-7-13: Endpoint URL validation in agent registration", () => {
    // Issue a fresh passport for these tests since the beforeAll passport
    // may have been revoked by the admin auth tests above.
    let freshDid: string;
    let freshTokenId: string;
    let freshSerial: number;
    let freshWallet: string;

    beforeAll(async () => {
      const w = makeEvmWallet();
      const sig = await signWalletOwnership(w.privateKey, w.address);
      const res = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: w.address,
          signature: sig,
          tier: "silver",
          name: "EndpointValidationBot",
          capabilities: ["api_call"],
          endpoint: "https://agent.example.com",
        }),
      });
      const body = await res.json();
      freshDid = body.did;
      freshTokenId = body.tokenId;
      freshSerial = body.serialNumber;
      freshWallet = w.address;
    });

    it("POST /agents/register with ftp:// endpoint → 400", async () => {
      const res = await app.request("/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          did: freshDid,
          tokenId: freshTokenId,
          serial: freshSerial,
          accountId: freshWallet,
          name: "BadEndpointBot",
          capabilities: ["api_call"],
          endpoint: "ftp://agent.example.com",
          tier: "silver",
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("http");
    });

    it("POST /agents/register with javascript: endpoint → 400", async () => {
      const res = await app.request("/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          did: freshDid,
          tokenId: freshTokenId,
          serial: freshSerial,
          accountId: freshWallet,
          name: "XSSBot",
          capabilities: ["api_call"],
          endpoint: "javascript:alert(1)",
          tier: "silver",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("POST /agents/register with valid https:// endpoint → 200", async () => {
      const res = await app.request("/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          did: freshDid,
          tokenId: freshTokenId,
          serial: freshSerial,
          accountId: freshWallet,
          name: "ValidBot",
          capabilities: ["api_call"],
          endpoint: "https://valid-agent.example.com",
          tier: "silver",
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // SLICE-7-3: Rate limiting on POST /mcp/tools/:name
  // -------------------------------------------------------------------------
  describe("SLICE-7-3: Rate limiting on MCP tool endpoint", () => {
    it("returns 429 after exceeding rate limit (60 req/min)", async () => {
      // Fire 61 requests rapidly — the 61st should get 429
      const requests = Array.from({ length: 61 }, () =>
        app.request("/mcp/tools/get_tier_requirements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );

      const responses = await Promise.all(requests);
      const lastResponse = responses[responses.length - 1];

      // At least the last one should be 429 (others may be 200 or 429 depending on timing)
      expect(lastResponse.status).toBe(429);
      expect(lastResponse.headers.get("Retry-After")).toBeTruthy();
    });

    it("rate limit response includes X-RateLimit headers", async () => {
      // Use a fresh app instance to avoid interference
      const freshApp = makeTestApp();
      // Exhaust the limit
      for (let i = 0; i < 61; i++) {
        await freshApp.request("/mcp/tools/get_tier_requirements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      }

      const res = await freshApp.request("/mcp/tools/get_tier_requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      expect(res.status).toBe(429);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    });

    it("GET /mcp/tools is not rate limited (only POST /mcp/tools/:name)", async () => {
      // GET requests should never be rate limited
      for (let i = 0; i < 65; i++) {
        const res = await app.request("/mcp/tools");
        expect(res.status).toBe(200);
      }
    });
  });
});
