import { describe, it, expect } from "vitest";
import { wellKnownRoutes } from "../../src/server/routes/well-known";
import { landingRoutes } from "../../src/server/routes/landing";
import { catalogRoutes } from "../../src/server/routes/catalog";

/**
 * SLICE-49-12: Server integration tests for all isitagentready compliance endpoints.
 *
 * Tests all 9 endpoint groups from slices 49-1 through 49-9 against
 * the actual Hono app instances (not mocked).
 */

describe("SLICE-49-12: isitagentready compliance endpoints (integration)", () => {
  describe("Link headers (RFC 8288)", () => {
    it("GET / returns Link header", async () => {
      const res = await landingRoutes.request("/");
      expect(res.status).toBe(200);
      expect(res.headers.get("Link")).toBeTruthy();
    });

    it("Link header contains api-catalog relation", async () => {
      const res = await landingRoutes.request("/");
      const link = res.headers.get("Link") ?? "";
      expect(link).toContain("api-catalog");
    });

    it("Link header contains service-desc relation", async () => {
      const res = await landingRoutes.request("/");
      const link = res.headers.get("Link") ?? "";
      expect(link).toContain("service-desc");
    });

    it("Link header contains oauth-server relation", async () => {
      const res = await landingRoutes.request("/");
      const link = res.headers.get("Link") ?? "";
      expect(link).toContain("oauth-server");
    });
  });

  describe("API Catalog (RFC 9727)", () => {
    it("GET /.well-known/api-catalog returns linkset+json", async () => {
      const res = await wellKnownRoutes.request("/.well-known/api-catalog");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/linkset+json");
    });

    it("api-catalog body has linkset array", async () => {
      const res = await wellKnownRoutes.request("/.well-known/api-catalog");
      const body = await res.json();
      expect(body.linkset).toBeInstanceOf(Array);
    });

    it("api-catalog linkset entries have anchor and service-desc", async () => {
      const res = await wellKnownRoutes.request("/.well-known/api-catalog");
      const body = await res.json();
      const first = body.linkset[0];
      expect(first).toHaveProperty("anchor");
      expect(first).toHaveProperty("service-desc");
    });
  });

  describe("OAuth Protected Resource (RFC 9728)", () => {
    it("GET /.well-known/oauth-protected-resource returns JSON", async () => {
      const res = await wellKnownRoutes.request("/.well-known/oauth-protected-resource");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resource).toBeDefined();
    });

    it("oauth-protected-resource has authorization_servers array", async () => {
      const res = await wellKnownRoutes.request("/.well-known/oauth-protected-resource");
      const body = await res.json();
      expect(body.authorization_servers).toBeInstanceOf(Array);
    });

    it("oauth-protected-resource has bearer_methods_supported", async () => {
      const res = await wellKnownRoutes.request("/.well-known/oauth-protected-resource");
      const body = await res.json();
      expect(body.bearer_methods_supported).toBeInstanceOf(Array);
    });
  });

  describe("Auth.md", () => {
    it("GET /auth.md returns markdown", async () => {
      const res = await wellKnownRoutes.request("/auth.md", {
        headers: { Accept: "text/markdown, */*" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("auth.md contains registration instructions", async () => {
      const res = await wellKnownRoutes.request("/auth.md");
      const text = await res.text();
      expect(text).toContain("register");
    });
  });

  describe("Agent Skills index", () => {
    it("GET /.well-known/agent-skills/index.json returns JSON", async () => {
      const res = await wellKnownRoutes.request("/.well-known/agent-skills/index.json");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.$schema).toBeDefined();
    });

    it("agent-skills has skills array", async () => {
      const res = await wellKnownRoutes.request("/.well-known/agent-skills/index.json");
      const body = await res.json();
      expect(body.skills).toBeInstanceOf(Array);
    });
  });

  describe("Content Signals", () => {
    it("GET /robots.txt contains Content-Signal", async () => {
      const res = await wellKnownRoutes.request("/robots.txt");
      const text = await res.text();
      expect(text).toContain("Content-Signal:");
    });
  });

  describe("Web Bot Auth", () => {
    it("GET /.well-known/http-message-signatures-directory returns JWKS", async () => {
      const res = await wellKnownRoutes.request("/.well-known/http-message-signatures-directory");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.keys).toBeInstanceOf(Array);
    });
  });

  describe("WebMCP", () => {
    it("GET / HTML contains navigator.modelContext", async () => {
      const res = await landingRoutes.request("/");
      const html = await res.text();
      expect(html).toContain("navigator.modelContext");
    });
  });

  describe("OAuth agent_auth block", () => {
    it("GET /.well-known/oauth-authorization-server has agent_auth", async () => {
      const res = await wellKnownRoutes.request("/.well-known/oauth-authorization-server");
      const body = await res.json();
      expect(body.agent_auth).toBeDefined();
    });

    it("agent_auth has register_uri", async () => {
      const res = await wellKnownRoutes.request("/.well-known/oauth-authorization-server");
      const body = await res.json();
      expect(body.agent_auth.register_uri).toBeDefined();
    });

    it("agent_auth has supported_identity_types", async () => {
      const res = await wellKnownRoutes.request("/.well-known/oauth-authorization-server");
      const body = await res.json();
      expect(body.agent_auth.supported_identity_types).toBeInstanceOf(Array);
    });
  });

  describe("Agent Card", () => {
    it("GET /.well-known/agent-card.json returns JSON", async () => {
      const res = await wellKnownRoutes.request("/.well-known/agent-card.json");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBeDefined();
    });

    it("agent-card has capabilities array", async () => {
      const res = await wellKnownRoutes.request("/.well-known/agent-card.json");
      const body = await res.json();
      expect(body.capabilities).toBeInstanceOf(Array);
    });
  });

  describe("AI Sitemap", () => {
    it("GET /ai-sitemap.xml returns XML", async () => {
      const res = await wellKnownRoutes.request("/ai-sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("xml");
    });

    it("ai-sitemap has resources root element", async () => {
      const res = await wellKnownRoutes.request("/ai-sitemap.xml");
      const text = await res.text();
      expect(text).toContain("<resources>");
    });
  });

  describe("LLMs.txt", () => {
    it("GET /llms.txt returns text", async () => {
      const res = await catalogRoutes.request("/llms.txt");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    });
  });
});
