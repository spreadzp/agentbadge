/**
 * SLICE-78-3: check_compliance MCP tool integration test.
 *
 * Verifies that the check_compliance tool is properly registered,
 * has correct schema, and responds to JSON-RPC tools/call.
 * Uses Hono in-process request — no running server needed.
 */

import { describe, it, expect } from "vitest";
import { mcpJsonRpc, mcpToolCall, getMcpTools, JSONRPC_ERRORS } from "../helpers/mcp";

describe("SLICE-78-3: check_compliance MCP tool (AB-103)", () => {
  it("check_compliance tool is discoverable via tools/list", async () => {
    const { status, body } = await mcpJsonRpc("tools/list");
    expect(status).toBe(200);
    const result = body.result as Record<string, unknown> | undefined;
    const tools = (result?.tools as Array<{ name: string }>) ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain("check_compliance");
  });

  it("check_compliance tool has correct schema with url parameter", () => {
    const tools = getMcpTools();
    const compliance = tools.find((t) => t.name === "check_compliance");
    expect(compliance).toBeDefined();
    const schema = compliance?.inputSchema as Record<string, unknown>;
    const properties = schema?.properties as Record<string, unknown> | undefined;
    expect(properties?.url).toBeDefined();
    const required = schema?.required as string[] | undefined;
    expect(required).toContain("url");
  });

  it("check_compliance tool has meaningful description", () => {
    const tools = getMcpTools();
    const compliance = tools.find((t) => t.name === "check_compliance");
    expect(compliance).toBeDefined();
    expect(compliance!.description).toContain("compliance");
    expect(compliance!.description.length).toBeGreaterThan(20);
  });

  it("tools/call with check_compliance returns JSON-RPC envelope (may error on scan)", async () => {
    // Use a localhost URL that will fail fast — we only care about the
    // JSON-RPC envelope shape, not the actual scan result.
    const { status, body } = await mcpToolCall("check_compliance", {
      url: "http://localhost:1",
    });
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    // Either a result (scan completed) or error (scan failed) — both are valid
    expect(body.result !== undefined || body.error !== undefined).toBe(true);
  }, 15000);

  it("tools/call with missing url parameter returns error", async () => {
    const { status, body } = await mcpToolCall("check_compliance", {});
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    // Should return either a tool error or JSON-RPC error
    const error = body.error as Record<string, unknown> | undefined;
    const result = body.result as Record<string, unknown> | undefined;
    const isError = result?.isError === true || error !== undefined;
    expect(isError).toBe(true);
  });

  it("tools/call with invalid URL returns validation error", async () => {
    const { status, body } = await mcpToolCall("check_compliance", {
      url: "not-a-valid-url",
    });
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    const result = body.result as Record<string, unknown> | undefined;
    const error = body.error as Record<string, unknown> | undefined;
    const isError = result?.isError === true || error !== undefined;
    expect(isError).toBe(true);
  });

  it("tools/call with non-existent tool returns method not found error", async () => {
    const { status, body } = await mcpToolCall("non_existent_tool", {});
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    const error = body.error as Record<string, unknown> | undefined;
    expect(error).toBeDefined();
    expect(error?.code).toBe(JSONRPC_ERRORS.METHOD_NOT_FOUND);
  });
});
