/**
 * E2E test: MCP server health, HTTP transport handshake, and tool listing.
 *
 * Tests the full MCP flow that Windsurf (or any MCP client) uses:
 * 1. GET /health — server is alive, MCP tools registered
 * 2. GET /mcp/tools — REST endpoint lists all tools
 * 3. POST /mcp — MCP initialize handshake (JSON-RPC over HTTP)
 * 4. POST /mcp — MCP tools/list (JSON-RPC after initialize)
 * 5. POST /mcp/tools/:toolName — REST direct tool call (get_tier_requirements)
 *
 * In dev mode, MCP comes from local packages (file:../../packages/mcp),
 * not from npm. This test validates the local package integration.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { setupMockEnv, makeTestApp } from "./helpers";
import {
  registerPassportTools,
  registerSigningTools,
  registerEscrowTools,
  registerAuditCatalogTools,
  registerDirectoryTools,
  registerA2ATools,
  registerMarketplaceTools,
  registerDatasetTools,
  registerDiscoveryTools,
  registerGuideTools,
  registerAllTools,
  listTools,
} from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "../../src/mcp/compliance-tools";
import { registerParityTools } from "../../src/mcp/parity-tools";

const BASE_URL = "http://localhost:4021";
const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

// ─── In-process tests (via Hono app, no running server needed) ───────────────

describe("MCP Health — in-process (Hono app)", () => {
  beforeAll(() => {
    setupMockEnv();
    registerPassportTools();
    registerAuditCatalogTools();
    registerDirectoryTools();
    registerA2ATools();
    registerMarketplaceTools();
    registerSigningTools();
    registerEscrowTools();
    registerDatasetTools();
    registerDiscoveryTools();
    registerGuideTools();
    registerAllTools();
    registerComplianceTools();
    registerParityTools();
  });

  it("listTools() returns 65 tools", () => {
    const tools = listTools();
    console.log(`[MCP Health] listTools() returned ${tools.length} tools:`, tools.map((t) => t.name));
    expect(tools.length).toBe(65);
  });

  it("all 65 tool names are unique", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("expected tool names are present", () => {
    const tools = listTools();
    const names = new Set(tools.map((t) => t.name));
    const expected = [
      "request_passport",
      "upload_image",
      "verify_passport",
      "get_passport",
      "list_passports",
      "upgrade_tier",
      "revoke_passport",
      "get_audit_trail",
      "get_tier_requirements",
      "register_agent",
      "find_agents",
      "send_message",
      "get_inbox",
      "get_conversation",
      "post_task",
      "list_tasks",
      "claim_task",
      "deliver_result",
      "prepare_payment",
      "complete_task",
    ];
    for (const name of expected) {
      expect(names.has(name)).toBe(true);
    }
  });

  // NOTE: /health route is registered in index.ts, not in makeTestApp().
  // Tested via live server section below.

  it("GET /mcp/tools returns 65 tools via REST", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/tools");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tools).toBeDefined();
    expect(Array.isArray(data.tools)).toBe(true);
    console.log(`[MCP Health] /mcp/tools returned ${data.tools.length} tools`);
    expect(data.tools.length).toBe(65);
  });

  it("POST /mcp/tools/get_tier_requirements returns tier catalog", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/tools/get_tier_requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    const parsed = JSON.parse(data.content[0].text);
    expect(parsed.tiers).toBeDefined();
    expect(Object.keys(parsed.tiers)).toHaveLength(4);
    console.log(`[MCP Health] get_tier_requirements returned ${Object.keys(parsed.tiers).length} tiers`);
  });
});

// ─── SLICE-72-10: Namespace in-process tests ─────────────────────────────────

describe("SLICE-72-10: MCP namespace in-process (Hono app)", () => {
  it("GET /mcp/passport returns 406 without Accept: text/event-stream", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/passport");
    expect(res.status).toBe(406);
  });

  it("GET /mcp/passport returns SSE with Accept: text/event-stream", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/passport", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("GET /mcp/market returns SSE", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/market", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("GET /mcp/discovery returns SSE", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/discovery", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("GET /mcp/audit returns SSE", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/audit", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("GET /mcp/passport/tools returns 16 tools via REST", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/passport/tools");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tools).toBeDefined();
    expect(data.tools.length).toBe(16);
  });

  it("GET /mcp/audit/tools returns 29 tools via REST", async () => {
    const app = makeTestApp();
    const res = await app.request("/mcp/audit/tools");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tools.length).toBe(29);
  });

  it("GET /.well-known/mcp.json lists all namespace endpoints", async () => {
    const app = makeTestApp();
    const res = await app.request("/.well-known/mcp.json");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.remotes).toBeDefined();
    const remoteUrls = data.remotes.map((r: { url: string }) => r.url);
    expect(remoteUrls.some((u: string) => u.endsWith("/mcp/passport"))).toBe(true);
    expect(remoteUrls.some((u: string) => u.endsWith("/mcp/market"))).toBe(true);
    expect(remoteUrls.some((u: string) => u.endsWith("/mcp/discovery"))).toBe(true);
    expect(remoteUrls.some((u: string) => u.endsWith("/mcp/audit"))).toBe(true);
  });
});

// ─── Live server tests (requires running server on port 4021) ────────────────

describe("MCP Health — live server (localhost:4021)", () => {
  // Skip if server is not running
  let serverAlive = false;

  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      serverAlive = res.ok;
      console.log(`[MCP Health] Live server check: ${serverAlive ? "ALIVE" : "DEAD"}`);
    } catch {
      serverAlive = false;
      console.log(`[MCP Health] Live server not reachable on ${BASE_URL}`);
    }
  });

  it("GET /health — server responds with healthy status", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("healthy");
    console.log(`[MCP Health] Live /health:`, JSON.stringify(data, null, 2));
  });

  it("GET /mcp/tools — REST endpoint returns tool list", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/mcp/tools`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tools).toBeDefined();
    expect(data.tools.length).toBeGreaterThanOrEqual(65);
    console.log(
      `[MCP Health] Live /mcp/tools: ${data.tools.length} tools —`,
      data.tools.map((t: { name: string }) => t.name).join(", "),
    );
  });

  it("POST /mcp — MCP initialize handshake succeeds", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "e2e-test", version: "1.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();

    // Response is SSE format: "event: message\ndata: {...}"
    expect(text).toContain("event: message");
    expect(text).toContain("data: ");

    // Extract JSON from SSE data line
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const json = JSON.parse(dataLine!.replace("data: ", ""));

    expect(json.jsonrpc).toBe("2.0");
    expect(json.id).toBe(1);
    expect(json.result).toBeDefined();
    expect(json.result.protocolVersion).toBe("2024-11-05");
    expect(json.result.serverInfo.name).toBe("all");
    console.log(`[MCP Health] MCP initialize OK — server: ${json.result.serverInfo.name} v${json.result.serverInfo.version}`);

    // Session ID should be in response headers
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    console.log(`[MCP Health] Session ID: ${sessionId}`);
  });

  it("POST /mcp — returns error without Accept header (diagnostic)", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    });
    // Should get 400 with "Not Acceptable" error — this is expected MCP behavior
    const data = await res.json();
    expect(data.error).toBeDefined();
    console.log(`[MCP Health] No Accept header → error ${data.error.code}: ${data.error.message}`);
  });

  it("POST /mcp/tools/get_tier_requirements — REST direct tool call works", async ({ skip }) => {
    if (!serverAlive) return skip();
    const res = await fetch(`${BASE_URL}/mcp/tools/get_tier_requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isError).toBeFalsy();
    const parsed = JSON.parse(data.content[0].text);
    expect(parsed.tiers).toBeDefined();
    console.log(`[MCP Health] Live tool call get_tier_requirements → ${Object.keys(parsed.tiers).length} tiers`);
  });
});
