import { describe, it, expect, vi } from "vitest";
import { fetchMcpProbe } from "../../../src/agent-readiness/scanner/fetchers/mcp-probe-fetcher";

describe("SLICE-48-3: mcp-probe-fetcher", () => {
  it("sends initialize and records protocolVersion + capabilities + serverInfo", async () => {
    const mockFetch = vi.fn().mockImplementation((_url: string, opts: any) => {
      if (opts?.method === "POST") {
        const body = JSON.parse(opts.body);
        if (body.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0", id: 1, result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "AgentBadge", version: "1.0.0" },
            },
          }), { headers: { "content-type": "application/json" } });
        }
        if (body.method === "tools/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0", id: 2, result: { tools: [{ name: "scan_url", inputSchema: {} }] },
          }), { headers: { "content-type": "application/json" } });
        }
      }
      if (opts?.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
      }
      if (opts?.headers?.Accept?.includes("text/event-stream")) {
        return new Response("event: ping\ndata: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(null, { status: 405 });
    });

    const result = await fetchMcpProbe("https://example.com", mockFetch);
    expect(result.source).toBe("mcp-probe");
    expect(result.data.initialize.status).toBe(200);
    expect(result.data.initialize.protocolVersion).toBe("2024-11-05");
    expect(result.data.initialize.serverInfo.name).toBe("AgentBadge");
    expect(result.data.toolsList.tools).toHaveLength(1);
    expect(result.data.cors.allowOrigin).toBe("*");
    expect(result.data.sse.supported).toBe(true);
  });

  it("handles 405 (endpoint exists but method not allowed)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 405 }));
    const result = await fetchMcpProbe("https://example.com", mockFetch);
    expect(result.data.initialize.status).toBe(405);
  });
});
