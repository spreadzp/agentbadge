import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";
import {
  buildAgentCard,
  buildAiSitemap,
  buildSitemap,
} from "../../src/server/routes/well-known";

setupMockEnv();
const app = makeTestApp();

const GITBOOK_URL = "https://agentbadge.gitbook.io/agentbadge-docs";
const GITBOOK_MCP = "https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp";

describe("GitBook discoverability — unit", () => {
  it("agent card has documentation field pointing to GitBook", () => {
    const card = buildAgentCard();
    expect(card.documentation).toBe(GITBOOK_URL);
  });

  it("agent card endpoints.docs points to GitBook", () => {
    const card = buildAgentCard();
    expect(card.endpoints.docs).toBe(GITBOOK_URL);
  });

  it("agent card endpoints.gitbook_mcp points to GitBook MCP", () => {
    const card = buildAgentCard();
    expect(card.endpoints.gitbook_mcp).toBe(GITBOOK_MCP);
  });

  it("ai-sitemap.xml contains GitBook docs URL", () => {
    const xml = buildAiSitemap();
    expect(xml).toContain(GITBOOK_URL);
  });

  it("ai-sitemap.xml contains GitBook MCP URL", () => {
    const xml = buildAiSitemap();
    expect(xml).toContain(GITBOOK_MCP);
  });

  it("sitemap.xml contains GitBook URL", () => {
    const xml = buildSitemap();
    expect(xml).toContain(GITBOOK_URL);
  });
});

describe("GitBook discoverability — E2E", () => {
  it("GET /llms.txt contains GitBook URL", async () => {
    const res = await app.request("/llms.txt");
    const text = await res.text();
    expect(text).toContain(GITBOOK_URL);
  });

  it("GET /llms.txt contains GitBook MCP URL", async () => {
    const res = await app.request("/llms.txt");
    const text = await res.text();
    expect(text).toContain(GITBOOK_MCP);
  });

  it("GET /llms-full.txt contains GitBook URL", async () => {
    const res = await app.request("/llms-full.txt");
    const text = await res.text();
    expect(text).toContain(GITBOOK_URL);
  });

  it("GET /.well-known/agent-card.json has documentation field", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const json = await res.json();
    expect(json.documentation).toBe(GITBOOK_URL);
  });

  it("GET /.well-known/agent-card.json has gitbook_mcp endpoint", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const json = await res.json();
    expect(json.endpoints.gitbook_mcp).toBe(GITBOOK_MCP);
  });

  it("GET /agency.json has documentation.gitbook field", async () => {
    const res = await app.request("/agency.json");
    const json = await res.json();
    expect(json.documentation.gitbook).toBe(GITBOOK_URL);
  });

  it("GET /agency.json has documentation.gitbook_mcp field", async () => {
    const res = await app.request("/agency.json");
    const json = await res.json();
    expect(json.documentation.gitbook_mcp).toBe(GITBOOK_MCP);
  });

  it("GET /robots.txt contains GitBook sitemap reference", async () => {
    const res = await app.request("/robots.txt");
    const text = await res.text();
    expect(text).toContain("agentbadge.gitbook.io");
  });

  it("GET /ai-sitemap.xml contains GitBook URL", async () => {
    const res = await app.request("/ai-sitemap.xml");
    const text = await res.text();
    expect(text).toContain(GITBOOK_URL);
  });

  it("GET /sitemap.xml contains GitBook URL", async () => {
    const res = await app.request("/sitemap.xml");
    const text = await res.text();
    expect(text).toContain(GITBOOK_URL);
  });
});
