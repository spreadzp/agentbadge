/**
 * SLICE-233-8: manifest ≡ registry ≡ HEAVY_OPS parity (O5) — any drift
 * between the three surfaces turns this file red. Plus the keyless
 * invariants: webmcp-channel tools are auth:"none" by construction
 * (D-233-8) and batch JSON-RPC is rejected outright (no per-call
 * counting ambiguity — the transport refuses arrays).
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  AGENT_INTERACTION_MANIFEST_PATH,
  AGENT_INTERACTION_MCP_PATH,
  AGENT_INTERACTION_PROTOCOL_VERSION,
  AGENT_INTERACTION_TOOLS,
} from "../../src/server/lib/agent-interaction/registry";
import { buildAgentInteractionManifest } from "../../src/server/lib/agent-interaction/manifest";
import { DEFAULT_HEAVY_OPS } from "../../src/server/middleware/mcp-abuse-guard";
import { mcpAgentInteractionRoutes } from "../../src/server/routes/mcp-agent-interaction";
import { manifestApp, rpc, ROSTER } from "../mcp/agent-interaction-harness";

describe("manifest ≡ registry (field-level 1:1)", () => {
  it("every tool: name/status/auth/rateClass/rest_equivalent/channel", async () => {
    const res = await manifestApp.request(AGENT_INTERACTION_MANIFEST_PATH);
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as {
      tools: Array<Record<string, unknown>>;
      mcp_endpoint: string;
      protocol_version: string;
      webhooks: { status: string; signature_header: string };
      requests: { states: string[] };
    };

    expect(manifest.mcp_endpoint).toBe(AGENT_INTERACTION_MCP_PATH);
    expect(manifest.protocol_version).toBe(AGENT_INTERACTION_PROTOCOL_VERSION);
    expect(manifest.tools).toHaveLength(AGENT_INTERACTION_TOOLS.length);

    const byName = new Map(manifest.tools.map((t) => [t.name, t]));
    for (const reg of AGENT_INTERACTION_TOOLS) {
      const m = byName.get(reg.name);
      expect(m, `manifest missing ${reg.name}`).toBeDefined();
      expect(m!.status).toBe(reg.status);
      expect(m!.auth).toBe(reg.auth);
      expect(m!.rateClass).toBe(reg.rateClass);
      expect(m!.rest_equivalent).toBe(reg.rest_equivalent);
      expect(m!.channel).toEqual([...reg.channel]);
    }

    // shipped reality pins: all live (the NOT_AVAILABLE seam never
    // materialized — 229/230 shipped before 233-5), webhook delivery live.
    expect(manifest.tools.every((t) => t.status === "live")).toBe(true);
    expect(manifest.webhooks.status).toBe("live");
    expect(manifest.webhooks.signature_header).toBe("X-AgentBadge-Signature");
    expect(manifest.requests.states).toEqual([
      "submitted",
      "working",
      "completed",
      "failed",
      "expired",
    ]);
  });

  it("builder output ≡ served manifest (route returns the builder verbatim)", async () => {
    const res = await manifestApp.request(AGENT_INTERACTION_MANIFEST_PATH);
    const served = await res.json();
    expect(served).toEqual(buildAgentInteractionManifest());
  });
});

describe("HEAVY_OPS ≡ rateClass:heavy union (D-233-7)", () => {
  it("every heavy registry tool is in DEFAULT_HEAVY_OPS — and vice versa for agentbadge_*", () => {
    const registryHeavy = AGENT_INTERACTION_TOOLS.filter(
      (t) => t.rateClass === "heavy",
    ).map((t) => t.name);
    const heavyAgentOps = DEFAULT_HEAVY_OPS.filter((n) =>
      n.startsWith("agentbadge_"),
    );
    expect([...heavyAgentOps].sort()).toEqual([...registryHeavy].sort());
    // sanity: the union is non-empty (the roster actually has heavy tools)
    expect(registryHeavy.length).toBeGreaterThanOrEqual(5);
  });
});

describe("tools/list ≡ registry", () => {
  it("names match the roster order; every tool carries an inputSchema", async () => {
    const res = await rpc("tools/list");
    const body = (await res.json()) as {
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    };
    expect(body.result.tools.map((t) => t.name)).toEqual(ROSTER);
    for (const t of body.result.tools) {
      expect(t.inputSchema, `${t.name} schema`).toBeTruthy();
    }
  });
});

describe("keyless invariants (D-233-1/8)", () => {
  it("webmcp shelf = exactly the 5 keyless-reachable tools; none may require a key", () => {
    const webmcpTools = AGENT_INTERACTION_TOOLS.filter((t) =>
      t.channel.includes("webmcp"),
    );
    // The /for-agents shelf (233-6): discover, ask, get_request_status,
    // create_task_request, search_knowledge.
    expect(webmcpTools.map((t) => t.name).sort()).toEqual(
      [
        "agentbadge_ask",
        "agentbadge_create_task_request",
        "agentbadge_discover",
        "agentbadge_get_request_status",
        "agentbadge_search_knowledge",
      ].sort(),
    );
    // D-233-8: every webmcp tool must stay callable with NO credential —
    // "none" or "agb_optional" (key optional); a future required-key
    // variant would break keyless-by-construction and fail here.
    for (const t of webmcpTools) {
      expect(t.auth === "none" || t.auth === "agb_optional").toBe(true);
    }
    // Verified-write tools stay MCP-only (verified writes = keyed lane).
    const mcpOnly = AGENT_INTERACTION_TOOLS.filter(
      (t) => !t.channel.includes("webmcp"),
    );
    expect(mcpOnly.every((t) => t.auth === "agb_optional")).toBe(true);
  });

  it("batch JSON-RPC → -32600 (stateless single-message, no counting loophole)", async () => {
    const res = await new Hono()
      .route("/", mcpAgentInteractionRoutes)
      .request("/mcp/agent-interaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
        ]),
      });
    const body = (await res.json()) as {
      error: { code: number; message: string };
    };
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toContain("batch");
  });
});
