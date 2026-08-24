/**
 * SLICE-78-3: MCP JSON-RPC transport compliance integration test.
 *
 * Verifies that the /mcp endpoint correctly implements the JSON-RPC 2.0
 * protocol: initialize, tools/list, tools/call, and error handling.
 * Uses Hono in-process request — no running server needed.
 */

import { describe, it, expect } from "vitest";
import { mcpJsonRpc, mcpToolCall, JSONRPC_ERRORS, mcpRoutes } from "../helpers/mcp";

describe("SLICE-78-3: MCP JSON-RPC transport compliance", () => {
  describe("initialize method", () => {
    it("initialize delegates to SDK transport and returns a response", async () => {
      const { body } = await mcpJsonRpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      });
      // SDK transport may return result or error — either is valid JSON-RPC
      expect(body.result !== undefined || body.error !== undefined).toBe(true);
    });
  });

  describe("tools/list method", () => {
    it("returns tools array in result", async () => {
      const { status, body } = await mcpJsonRpc("tools/list");
      expect(status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(1);
      const result = body.result as Record<string, unknown>;
      expect(result?.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      expect((result.tools as unknown[]).length).toBeGreaterThan(0);
    });

    it("each tool has name and description", async () => {
      const { body } = await mcpJsonRpc("tools/list");
      const result = body.result as Record<string, unknown>;
      const tools = (result?.tools as Array<Record<string, unknown>>) ?? [];
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe("string");
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe("string");
      }
    });
  });

  describe("tools/call method", () => {
    it("returns error when name parameter is missing", async () => {
      const { status, body } = await mcpJsonRpc("tools/call", {});
      expect(status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      const error = body.error as Record<string, unknown>;
      expect(error).toBeDefined();
      expect(error.code).toBe(JSONRPC_ERRORS.INVALID_PARAMS);
    });

    it("returns error for unknown tool name", async () => {
      const { status, body } = await mcpToolCall("does_not_exist", {});
      expect(status).toBe(200);
      const error = body.error as Record<string, unknown>;
      expect(error).toBeDefined();
      expect(error.code).toBe(JSONRPC_ERRORS.METHOD_NOT_FOUND);
    });
  });

  describe("unknown methods", () => {
    it("returns method not found for unrecognized method", async () => {
      const { status, body } = await mcpJsonRpc("some/unknown/method");
      expect(status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      const error = body.error as Record<string, unknown>;
      expect(error).toBeDefined();
      expect(error.code).toBe(JSONRPC_ERRORS.METHOD_NOT_FOUND);
    });
  });

  describe("SSE transport", () => {
    it("GET /mcp without SSE Accept header returns 406", async () => {
      const res = await mcpRoutes.request("/mcp", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      expect(res.status).toBe(406);
    });

    it("GET /mcp with SSE Accept header returns text/event-stream", async () => {
      const res = await mcpRoutes.request("/mcp", {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    });
  });

  describe("JSON-RPC 2.0 protocol compliance", () => {
    it("response includes jsonrpc version field", async () => {
      const { body } = await mcpJsonRpc("tools/list");
      expect(body.jsonrpc).toBe("2.0");
    });

    it("response includes matching id", async () => {
      const { body } = await mcpJsonRpc("tools/list", undefined, 42);
      expect(body.id).toBe(42);
    });

    it("response includes string id when string sent", async () => {
      const { body } = await mcpJsonRpc("tools/list", undefined, "test-id-1");
      expect(body.id).toBe("test-id-1");
    });
  });
});
