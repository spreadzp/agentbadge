import { describe, it, expect } from "vitest";
import { makeTestApp } from "./e2e/helpers";
import { openApiConfig } from "../src/server/openapi";

describe("SLICE-74-1: Endpoint audit & fixes", () => {
  it("GET /ai.txt returns 200 with text/plain, includes User-agent and Allow/Disallow", async () => {
    const app = makeTestApp();
    const res = await app.request("/ai.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("User-agent");
    expect(text).toContain("Allow");
    expect(text).toContain("Disallow");
  });

  it("GET /.well-known/mcp.json returns 200 with name, version, remotes", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/mcp.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data.name).toBeDefined();
    expect(data.version).toBeDefined();
    expect(data.remotes).toBeDefined();
    expect(Array.isArray(data.remotes)).toBe(true);
  });

  it("GET /.well-known/llm-policy.json returns 200 with application/json", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/llm-policy.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET /.well-known/oauth-authorization-server returns 200 with RFC 8414 fields", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data.issuer).toBeDefined();
    expect(data.authorization_endpoint).toBeDefined();
    expect(data.token_endpoint).toBeDefined();
    expect(data.jwks_uri).toBeDefined();
    expect(data.response_types_supported).toBeDefined();
    expect(data.grant_types_supported).toBeDefined();
  });

  it("GET /docs returns 302 redirect to GitBook", async () => {
    const app = makeTestApp();
    const res = await app.request("/docs", { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe("https://agentbadge.gitbook.io/agentbadge-docs");
  });

  it("GET /health returns 200 with application/json", async () => {
    const app = makeTestApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET /.well-known/api-catalog service-doc link points to /docs (now 302)", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/api-catalog");
    expect(res.status).toBe(200);
    const data = await res.json();
    const serviceDoc = data.linkset?.[0]?.["service-doc"]?.[0];
    expect(serviceDoc).toBeDefined();
    expect(serviceDoc.href).toContain("/docs");
  });

  it("GET /.well-known/api-catalog status link points to /health (200)", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/api-catalog");
    const data = await res.json();
    const status = data.linkset?.[0]?.["status"]?.[0];
    expect(status).toBeDefined();
    expect(status.href).toContain("/health");
  });
});

describe("SLICE-74-2: Agent Card & API Catalog hardening", () => {
  it("GET /.well-known/agent-card.json — version is 1.0.0", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/agent-card.json");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.version).toBe("1.0.0");
  });

  it("GET /.well-known/agent-card.json — endpoints.documentation exists", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/agent-card.json");
    const data = await res.json();
    expect(data.endpoints).toBeDefined();
    expect(data.endpoints.documentation).toBeDefined();
    expect(data.endpoints.documentation).toContain("gitbook.io");
  });

  it("GET /.well-known/agent-card.json — endpoints.docs exists", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/agent-card.json");
    const data = await res.json();
    expect(data.endpoints.docs).toBeDefined();
    expect(data.endpoints.docs).toContain("gitbook.io");
  });

  it("openApiConfig.info.version is 1.0.0", () => {
    expect(openApiConfig.info.version).toBe("1.0.0");
  });
});

describe("SLICE-74-3: Blog articles in ai-sitemap.xml", () => {
  it("ai-sitemap includes /blog index page with type=html", async () => {
    const app = makeTestApp();
    const res = await app.request("/ai-sitemap.xml");
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("/blog</loc>");
    expect(xml).toContain("<type>html</type>");
  });

  it("ai-sitemap includes blog article with type=markdown", async () => {
    const app = makeTestApp();
    const res = await app.request("/ai-sitemap.xml");
    const xml = await res.text();
    expect(xml).toContain("/blog/what-is-agent-readiness");
    expect(xml).toContain("<type>markdown</type>");
  });

  it("ai-sitemap includes lastmod for blog articles", async () => {
    const app = makeTestApp();
    const res = await app.request("/ai-sitemap.xml");
    const xml = await res.text();
    expect(xml).toContain("<lastmod>");
  });

  it("ai-sitemap includes priority 0.7 for blog articles", async () => {
    const app = makeTestApp();
    const res = await app.request("/ai-sitemap.xml");
    const xml = await res.text();
    expect(xml).toContain("<priority>0.7</priority>");
  });
});

describe("SLICE-74-4: Sitemap & robots.txt polish", () => {
  it("robots.txt includes Crawl-delay directive", async () => {
    const app = makeTestApp();
    const res = await app.request("/robots.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Crawl-delay:");
  });

  it("sitemap.xml has /changelog with priority 0.8", async () => {
    const app = makeTestApp();
    const res = await app.request("/sitemap.xml");
    expect(res.status).toBe(200);
    const xml = await res.text();
    const changelogIdx = xml.indexOf("/changelog</loc>");
    expect(changelogIdx).toBeGreaterThan(-1);
    const afterChangelog = xml.slice(changelogIdx, changelogIdx + 200);
    expect(afterChangelog).toContain("<priority>0.8</priority>");
  });
});
