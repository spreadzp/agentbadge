import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  createNamespace,
  getNamespace,
  listAllNamespaces,
  NamespaceRegistry,
  registerTool,
  listTools,
  handleHttpToolCall,
} from "@agentgate-hedera/mcp";

describe("NamespaceRegistry", () => {
  it("should create a NamespaceRegistry instance with createNamespace", () => {
    const ns = createNamespace("test-passport");
    expect(ns).toBeInstanceOf(NamespaceRegistry);
  });

  it("should return the same instance when createNamespace called twice with same name", () => {
    const ns1 = createNamespace("test-dedup");
    const ns2 = createNamespace("test-dedup");
    expect(ns1).toBe(ns2);
  });

  it("should isolate tools between namespaces", () => {
    const passportNs = createNamespace("iso-passport");
    const marketNs = createNamespace("iso-market");

    passportNs.registerTool(
      "iso_passport_tool",
      "Passport tool",
      { id: z.string() },
      async () => ({ content: [{ type: "text", text: "passport" }] }),
    );

    marketNs.registerTool(
      "iso_market_tool",
      "Market tool",
      { id: z.string() },
      async () => ({ content: [{ type: "text", text: "market" }] }),
    );

    const passportTools = passportNs.listTools();
    const marketTools = marketNs.listTools();

    expect(passportTools.map((t) => t.name)).toContain("iso_passport_tool");
    expect(passportTools.map((t) => t.name)).not.toContain("iso_market_tool");
    expect(marketTools.map((t) => t.name)).toContain("iso_market_tool");
    expect(marketTools.map((t) => t.name)).not.toContain("iso_passport_tool");
  });

  it("should resolve tool calls within its own namespace only", async () => {
    const nsA = createNamespace("resolve-a");
    const nsB = createNamespace("resolve-b");

    nsA.registerTool(
      "resolve_tool_a",
      "Tool A",
      {},
      async () => ({ content: [{ type: "text", text: "from-a" }] }),
    );

    const resultA = await nsA.handleHttpToolCall("resolve_tool_a", {});
    expect(resultA.content[0].text).toBe("from-a");

    const resultB = await nsB.handleHttpToolCall("resolve_tool_a", {});
    expect(resultB.isError).toBe(true);
  });

  it("should list all created namespaces via listAllNamespaces", () => {
    createNamespace("list-test-1");
    createNamespace("list-test-2");
    const all = listAllNamespaces();
    expect(all).toContain("list-test-1");
    expect(all).toContain("list-test-2");
  });

  it("should retrieve a namespace via getNamespace", () => {
    const ns = createNamespace("get-test");
    expect(getNamespace("get-test")).toBe(ns);
    expect(getNamespace("nonexistent")).toBeUndefined();
  });

  it("should maintain backward-compatible global registerTool/listTools", () => {
    registerTool(
      "backward_compat_tool",
      "Backward compat test",
      { input: z.string() },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const tools = listTools();
    expect(tools.map((t) => t.name)).toContain("backward_compat_tool");
  });

  it("should handle tool not found gracefully", async () => {
    const ns = createNamespace("error-test");
    const result = await ns.handleHttpToolCall("nonexistent_tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});
