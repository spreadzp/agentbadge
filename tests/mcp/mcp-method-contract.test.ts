/**
 * SLICE-234-29: MCP method/error contract.
 *
 * Prod signals (7d): GET /mcp without SSE-Accept → 406 ×43 with a
 * one-line unstructured body; DELETE /mcp ×7 → fell into
 * mcpRoutes.all → c.req.json() threw → handleHttpRequest →
 * unpredictable SDK-transport response.
 *
 * Contract (transport 2025-06-18 — GET+SSE stays, "GET→405" advice
 * applies to a newer revision we don't run):
 *   GET  + Accept: text/event-stream → 200 text/event-stream
 *   GET  without SSE Accept            → 406 structured not_acceptable
 *   DELETE/PUT/PATCH                   → 405 + Allow: GET, POST
 *   POST JSON-RPC                      → 200 (unchanged)
 */
import { describe, it, expect } from "vitest";
import { mcpRoutes } from "../helpers/mcp";

const req = (method: string, headers: Record<string, string> = {}, body?: string) =>
  mcpRoutes.request("/mcp", {
    method,
    headers,
    body,
  });

describe("SLICE-234-29: MCP method/error contract", () => {
  it("GET /mcp + Accept: text/event-stream → 200 SSE stream", async () => {
    const res = await req("GET", { Accept: "text/event-stream" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toContain("event: ping");
  });

  it("GET /mcp without SSE Accept → 406 structured not_acceptable", async () => {
    const res = await req("GET", { Accept: "application/json" });
    expect(res.status).toBe(406);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("not_acceptable");
    expect(body.requires).toEqual(["text/event-stream"]);
    expect(body.allowed_methods).toEqual(["GET", "POST"]);
    expect(body.documentation).toBe("/agent-guide");
  });

  it.each(["DELETE", "PUT", "PATCH"])(
    "%s /mcp → 405 method_not_allowed + Allow: GET, POST",
    async (method) => {
      const res = await req(method, { "Content-Type": "application/json" }, "{}");
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, POST");
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("method_not_allowed");
      expect(body.allowed_methods).toEqual(["GET", "POST"]);
      expect(body.documentation).toBe("/agent-guide");
      expect(String(body.message)).toContain("HTTP POST");
    },
  );

  it("DELETE /mcp without body → still 405 (no JSON parse attempted)", async () => {
    const res = await req("DELETE");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
  });

  it("POST /mcp tools/list → 200 JSON-RPC (unchanged)", async () => {
    const res = await req(
      "POST",
      { "Content-Type": "application/json" },
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.jsonrpc).toBe("2.0");
    expect((body.result as Record<string, unknown>)?.tools).toBeDefined();
  });
});
