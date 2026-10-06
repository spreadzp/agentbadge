import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";
import type { DiscoverySources } from "../../src/server/lib/agent-discovery";
import {
  buildAgentCard,
  buildAiSitemap,
  buildSitemap,
} from "../../src/server/routes/well-known";

setupMockEnv();
const app = makeTestApp();

const GITBOOK_URL = "https://agentbadge.gitbook.io/agentbadge-docs";
const GITBOOK_MCP = "https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp";

// SLICE-178-2: buildAgentCard takes DiscoverySources and returns a JSON string.
const SRC: DiscoverySources = {
  baseUrl: "https://agentbadge.xyz",
  authSection: "",
  llmsCore: "",
  articles: [],
  faqEntries: [],
  tiers: [],
  appRoutes: [],
};
type AgentCardShape = {
  documentationUrl: string;
  "x-agentbadge": { endpoints: Record<string, string> };
  [k: string]: unknown;
};
const card = () => JSON.parse(buildAgentCard(SRC)) as AgentCardShape;

describe("GitBook discoverability — unit", () => {
  it("agent card has documentationUrl field pointing to GitBook", () => {
    expect(card().documentationUrl).toBe(GITBOOK_URL);
  });

  it("agent card x-agentbadge.endpoints.docs points to GitBook", () => {
    expect(card()["x-agentbadge"].endpoints.docs).toBe(GITBOOK_URL);
  });

  it("agent card x-agentbadge.endpoints.gitbook_mcp points to GitBook MCP", () => {
    expect(card()["x-agentbadge"].endpoints.gitbook_mcp).toBe(GITBOOK_MCP);
  });

  it("ai-sitemap.xml contains GitBook docs URL", () => {
    const xml = buildAiSitemap();
    expect(xml).toContain(GITBOOK_URL);
  });

  it("ai-sitemap.xml contains GitBook MCP URL", () => {
    const xml = buildAiSitemap();
    expect(xml).toContain(GITBOOK_MCP);
  });

  it("sitemap.xml is a valid on-site sitemap", () => {
    // sitemap.xml lists same-host PUBLIC_PAGES only — GitBook sitemap is
    // declared via the robots.txt Sitemap: directive (E2E below).
    const xml = buildSitemap();
    expect(xml).toContain("<urlset");
    expect(xml).toContain("<loc>");
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

  it("GET /.well-known/agent-card.json has documentationUrl field", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const json = await res.json();
    expect(json.documentationUrl).toBe(GITBOOK_URL);
  });

  it("GET /.well-known/agent-card.json has gitbook_mcp endpoint", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const json = await res.json();
    expect(json["x-agentbadge"].endpoints.gitbook_mcp).toBe(GITBOOK_MCP);
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

  it("GET /sitemap.xml returns a valid on-site sitemap", async () => {
    // GitBook (external host) is reachable via ai-sitemap.xml and the
    // robots.txt Sitemap: directive — both asserted above.
    const res = await app.request("/sitemap.xml");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<urlset");
  });
});
