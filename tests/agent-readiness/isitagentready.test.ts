import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../../src/server/routes/well-known";
import { landingRoutes } from "../../src/server/routes/landing";
import { hackathonRoutes } from "../../src/server/routes/hackathon";
import { createDiscoveryRoutes } from "../../src/server/routes/discovery";
import type { DiscoverySources } from "../../src/server/lib/agent-discovery";

let app: Hono;

// SLICE-178-2: api-catalog / oauth-protected-resource moved to the manifest
// registry — mount discovery routes alongside well-known.
const TEST_SOURCES: DiscoverySources = {
  baseUrl: "https://staging.agentbadge.xyz",
  authSection: "",
  llmsCore: "",
  articles: [],
  faqEntries: [],
  tiers: [],
  appRoutes: [],
};

beforeEach(() => {
  app = new Hono();
  app.route("/", createDiscoveryRoutes(() => TEST_SOURCES));
  app.route("/", wellKnownRoutes);
  app.route("/", landingRoutes);
});

// ── SLICE-49-1: Link headers on homepage (RFC 8288) ──────────────

describe("SLICE-49-1: Link headers on homepage (RFC 8288)", () => {
  it("returns Link header with api-catalog relation", async () => {
    const res = await app.request("/");
    const link = res.headers.get("Link");
    expect(link).toContain("</.well-known/api-catalog>");
    expect(link).toContain('rel="api-catalog"');
  });

  it("returns Link header with service-desc relation", async () => {
    const res = await app.request("/");
    const link = res.headers.get("Link");
    expect(link).toContain('rel="service-desc"');
  });

  it("returns Link header with oauth-server relation", async () => {
    const res = await app.request("/");
    const link = res.headers.get("Link");
    expect(link).toContain('rel="oauth-server"');
  });
});

// ── SLICE-49-2: API Catalog endpoint (RFC 9727) ──────────────────

describe("SLICE-49-2: API Catalog (RFC 9727)", () => {
  it("returns application/linkset+json", async () => {
    const res = await app.request("/.well-known/api-catalog", {
      headers: { Accept: "application/linkset+json" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/linkset+json");
  });

  it("returns linkset array with anchor and service-desc", async () => {
    const res = await app.request("/.well-known/api-catalog");
    const body = await res.json();
    expect(body.linkset).toBeInstanceOf(Array);
    expect(body.linkset.length).toBeGreaterThan(0);
    const entry = body.linkset[0];
    expect(entry).toHaveProperty("anchor");
    expect(entry).toHaveProperty("service-desc");
  });

  it("includes status relation for health endpoint", async () => {
    const res = await app.request("/.well-known/api-catalog");
    const body = await res.json();
    const hasStatus = body.linkset.some(
      (e: Record<string, unknown>) => e["status"],
    );
    expect(hasStatus).toBe(true);
  });
});

// ── SLICE-49-3: OAuth Protected Resource (RFC 9728) ──────────────

describe("SLICE-49-3: OAuth Protected Resource (RFC 9728)", () => {
  it("returns JSON at /.well-known/oauth-protected-resource", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("has resource field", async () => {
    const body = await (await app.request("/.well-known/oauth-protected-resource")).json();
    expect(body).toHaveProperty("resource");
    expect(body.resource).toContain("agentbadge.xyz");
  });

  it("has authorization_servers array", async () => {
    const body = await (await app.request("/.well-known/oauth-protected-resource")).json();
    expect(body.authorization_servers).toBeInstanceOf(Array);
    expect(body.authorization_servers.length).toBeGreaterThan(0);
  });

  it("has scopes_supported", async () => {
    const body = await (await app.request("/.well-known/oauth-protected-resource")).json();
    expect(body.scopes_supported).toBeInstanceOf(Array);
  });
});

// ── SLICE-49-4: Auth.md + agent_auth block ───────────────────────

describe("SLICE-49-4: Auth.md + agent_auth block", () => {
  it("serves /auth.md as markdown", async () => {
    const res = await app.request("/auth.md", {
      headers: { Accept: "text/markdown, text/plain, */*" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
  });

  it("contains registration instructions", async () => {
    const res = await app.request("/auth.md");
    const text = await res.text();
    expect(text).toContain("agent");
    expect(text).toContain("register");
  });

  it("oauth-authorization-server has agent_auth block", async () => {
    const body = await (await app.request("/.well-known/oauth-authorization-server")).json();
    expect(body).toHaveProperty("agent_auth");
    expect(body.agent_auth).toHaveProperty("register_uri");
  });
});

// ── SLICE-49-5: Agent Skills index ───────────────────────────────

describe("SLICE-49-5: Agent Skills index", () => {
  it("returns JSON at /.well-known/agent-skills/index.json", async () => {
    const res = await app.request("/.well-known/agent-skills/index.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("has $schema and skills array", async () => {
    const body = await (await app.request("/.well-known/agent-skills/index.json")).json();
    expect(body).toHaveProperty("$schema");
    expect(body.skills).toBeInstanceOf(Array);
    expect(body.skills.length).toBeGreaterThan(0);
  });

  it("each skill has required fields", async () => {
    const body = await (await app.request("/.well-known/agent-skills/index.json")).json();
    for (const skill of body.skills) {
      expect(skill).toHaveProperty("name");
      expect(skill).toHaveProperty("type");
      expect(skill).toHaveProperty("description");
      expect(skill).toHaveProperty("url");
      expect(skill).toHaveProperty("sha256");
    }
  });
});

// ── SLICE-49-6: Content Signals in robots.txt ────────────────────

describe("SLICE-49-6: Content Signals in robots.txt", () => {
  it("robots.txt contains Content-Signal directive", async () => {
    const res = await app.request("/robots.txt");
    const text = await res.text();
    expect(text).toContain("Content-Signal:");
  });

  it("declares ai-train preference", async () => {
    const text = await (await app.request("/robots.txt")).text();
    expect(text).toMatch(/Content-Signal:.*ai-train=/);
  });

  it("declares search preference", async () => {
    const text = await (await app.request("/robots.txt")).text();
    expect(text).toMatch(/Content-Signal:.*search=/);
  });

  it("declares ai-input preference", async () => {
    const text = await (await app.request("/robots.txt")).text();
    expect(text).toMatch(/Content-Signal:.*ai-input=/);
  });
});

// ── SLICE-49-7: Web Bot Auth directory ───────────────────────────

describe("SLICE-49-7: Web Bot Auth directory", () => {
  it("returns JSON at /.well-known/http-message-signatures-directory", async () => {
    const res = await app.request("/.well-known/http-message-signatures-directory");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("contains keys array", async () => {
    const body = await (await app.request("/.well-known/http-message-signatures-directory")).json();
    expect(body).toHaveProperty("keys");
    expect(body.keys).toBeInstanceOf(Array);
  });
});

// ── SLICE-49-9: WebMCP browser-side tools ────────────────────────

describe("SLICE-49-9: WebMCP browser-side tools", () => {
  // WebMCP inject script moved to /hackathon/webmcp and now uses
  // document.modelContext.registerTool() (spec migration, f62e648).
  it("webmcp page HTML includes document.modelContext.registerTool call", async () => {
    const res = await hackathonRoutes.request("/hackathon/webmcp");
    const html = await res.text();
    expect(html).toContain("modelContext");
    expect(html).toContain("registerTool");
  });

  it("includes at least one tool definition", async () => {
    const res = await hackathonRoutes.request("/hackathon/webmcp");
    const html = await res.text();
    expect(html).toContain("inputSchema");
    expect(html).toContain("execute");
  });
});
