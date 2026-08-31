/**
 * Tests for MCP Guide Tools — get_guide + list_guides
 *
 * Tests:
 * 1. list_guides returns 3 guides with correct names
 * 2. get_guide("agent") returns markdown starting with "# Agent Onboarding Guide"
 * 3. get_guide("market") returns markdown starting with "# Marketplace Agent Guide"
 * 4. get_guide("medical") returns markdown starting with "# Medical Data Skills Guide"
 * 5. get_guide("invalid") returns validation error
 * 6. get_guide({}) returns validation error (missing param)
 * 7. Tools appear in listTools() after registerGuideTools()
 */

import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { setupMockEnv, makeTestApp } from "./e2e/helpers";
import {
  registerPassportTools,
  registerAuditCatalogTools,
  registerDirectoryTools,
  registerA2ATools,
  registerMarketplaceTools,
  registerGuideTools,
  listTools,
} from "@agentbadge/mcp";

const BASE_URL = "http://localhost:4021";

const MOCK_GUIDES: Record<string, string> = {
  "/agent-guide": "# Agent Onboarding Guide\n\nWelcome, AI agent.",
  "/market-guide": "# Marketplace Agent Guide\n\nWelcome, AI agent.",
  "/medical-guide": "# Medical Data Skills Guide\n\nWelcome, AI agent.",
};

function mockFetch(url: string): Promise<Response> {
  const body = MOCK_GUIDES[url.replace(BASE_URL, "")] ?? "";
  return Promise.resolve(
    new Response(body, {
      status: body ? 200 : 404,
      headers: { "Content-Type": "text/markdown" },
    }),
  );
}

describe("MCP Guide Tools — in-process (mocked fetch)", () => {
  beforeAll(() => {
    setupMockEnv();
    registerPassportTools();
    registerAuditCatalogTools();
    registerDirectoryTools();
    registerA2ATools();
    registerMarketplaceTools();
    registerGuideTools();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listTools() includes get_guide and list_guides", () => {
    const tools = listTools();
    const names = new Set(tools.map((t) => t.name));
    expect(names.has("get_guide")).toBe(true);
    expect(names.has("list_guides")).toBe(true);
  });

  it("POST /mcp/tools/list_guides returns 3 guides", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/tools/list_guides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    const text = data.content[0].text;
    expect(text).toContain("agent");
    expect(text).toContain("market");
    expect(text).toContain("medical");
  });

  it("POST /mcp/tools/get_guide with guide=agent returns agent onboarding markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch as any);
    const app = makeTestApp();
    const res = await app.request("/mcp/tools/get_guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: "agent" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    expect(data.content[0].text).toContain("# Agent Onboarding Guide");
  });

  it("POST /mcp/tools/get_guide with guide=market returns marketplace markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch as any);
    const app = makeTestApp();
    const res = await app.request("/mcp/tools/get_guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: "market" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    expect(data.content[0].text).toContain("# Marketplace Agent Guide");
  });

  it("POST /mcp/tools/get_guide with guide=medical returns medical markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch as any);
    const app = makeTestApp();
    const res = await app.request("/mcp/tools/get_guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: "medical" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    expect(data.content[0].text).toContain("# Medical Data Skills Guide");
  });

  it("POST /mcp/tools/get_guide with invalid guide returns validation error", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/tools/get_guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: "invalid" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBe(true);
    expect(data.content[0].text).toContain("Invalid option");
  });

  it("POST /mcp/tools/get_guide with missing guide param returns validation error", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/tools/get_guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBe(true);
    expect(data.content[0].text).toContain("Invalid option");
  });
});

// ─── Live server tests (requires running server on port 4021) ────────────────

describe("MCP Guide Tools — live server (localhost:4021)", () => {
  let serverAlive = false;

  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      serverAlive = res.ok;
    } catch {
      serverAlive = false;
    }
  });

  it("POST /mcp/tools/list_guides — returns 3 guides via live server", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/mcp/tools/list_guides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    const text = data.content[0].text;
    expect(text).toContain("agent");
    expect(text).toContain("market");
    expect(text).toContain("medical");
  });

  it("POST /mcp/tools/get_guide — agent guide via live server", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/mcp/tools/get_guide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: "agent" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    expect(data.content[0].text).toContain("# Agent Onboarding Guide");
  });

  it("POST /mcp/tools/get_guide — market guide via live server", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/mcp/tools/get_guide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: "market" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    expect(data.content[0].text).toContain("# Marketplace Agent Guide");
  });

  it("POST /mcp/tools/get_guide — medical guide via live server", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/mcp/tools/get_guide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guide: "medical" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    expect(data.content[0].text).toContain("# Medical Data Skills Guide");
  });
});
