import { describe, it, expect, vi } from "vitest";
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
  registerTool,
  listTools,
  handleHttpToolCall,
} from "@agentbadge/mcp";

describe("NamespaceRegistry — createNamespace", () => {
  it("returns a NamespaceRegistry instance", () => {
    const ns = createNamespace("test-passport");
    expect(ns).toBeDefined();
    expect(typeof ns.registerTool).toBe("function");
    expect(typeof ns.listTools).toBe("function");
    expect(typeof ns.handleHttpToolCall).toBe("function");
  });

  it("returns the same instance on second call with same name", () => {
    const ns1 = createNamespace("test-dedup");
    const ns2 = createNamespace("test-dedup");
    expect(ns1).toBe(ns2);
  });

  it("getNamespace retrieves an existing namespace", () => {
    const ns = createNamespace("test-get");
    expect(getNamespace("test-get")).toBe(ns);
  });

  it("getNamespace returns undefined for unknown namespace", () => {
    expect(getNamespace("nonexistent-namespace")).toBeUndefined();
  });

  it("listAllNamespaces returns all created namespace names", () => {
    createNamespace("test-list-a");
    createNamespace("test-list-b");
    const names = listAllNamespaces();
    expect(names).toContain("test-list-a");
    expect(names).toContain("test-list-b");
  });
});

describe("NamespaceRegistry — tool isolation", () => {
  it("tools registered in one namespace do not appear in another", () => {
    const nsA = createNamespace("iso-a");
    const nsB = createNamespace("iso-b");

    nsA.registerTool("tool_a", "Tool A", { x: z.string() }, async () => ({
      content: [{ type: "text", text: "a" }],
    }));
    nsB.registerTool("tool_b", "Tool B", { y: z.string() }, async () => ({
      content: [{ type: "text", text: "b" }],
    }));

    const toolsA = nsA.listTools();
    const toolsB = nsB.listTools();

    expect(toolsA.some((t) => t.name === "tool_a")).toBe(true);
    expect(toolsA.some((t) => t.name === "tool_b")).toBe(false);
    expect(toolsB.some((t) => t.name === "tool_b")).toBe(true);
    expect(toolsB.some((t) => t.name === "tool_a")).toBe(false);
  });

  it("handleHttpToolCall in one namespace does not find tools from another", async () => {
    const nsX = createNamespace("iso-x");
    const nsY = createNamespace("iso-y");

    nsX.registerTool("shared_name", "In nsX", {}, async () => ({
      content: [{ type: "text", text: "from-x" }],
    }));
    nsY.registerTool("shared_name", "In nsY", {}, async () => ({
      content: [{ type: "text", text: "from-y" }],
    }));

    const resultX = await nsX.handleHttpToolCall("shared_name", {});
    const resultY = await nsY.handleHttpToolCall("shared_name", {});

    expect(resultX.content[0].text).toBe("from-x");
    expect(resultY.content[0].text).toBe("from-y");
  });

  it("handleHttpToolCall returns error for unknown tool within namespace", async () => {
    const ns = createNamespace("iso-err");
    const result = await ns.handleHttpToolCall("nonexistent", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nonexistent");
  });
});

describe("NamespaceRegistry — backward compatibility", () => {
  it("existing registerTool still works (delegates to default namespace)", () => {
    registerTool("backward_compat_tool", "Backward compat", { msg: z.string() }, async (args) => ({
      content: [{ type: "text", text: JSON.stringify({ message: (args as { msg: string }).msg }) }],
    }));

    const tools = listTools();
    expect(tools.some((t) => t.name === "backward_compat_tool")).toBe(true);
  });

  it("existing handleHttpToolCall still works", async () => {
    registerTool("backward_compat_call", "Backward compat call", {}, async () => ({
      content: [{ type: "text", text: "works" }],
    }));

    const result = await handleHttpToolCall("backward_compat_call", {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("works");
  });

  it("default namespace tools are isolated from named namespaces", () => {
    const nsCustom = createNamespace("compat-iso");
    registerTool("default_only_tool", "Default only", {}, async () => ({
      content: [{ type: "text", text: "default" }],
    }));

    const defaultTools = listTools();
    const customTools = nsCustom.listTools();

    expect(defaultTools.some((t) => t.name === "default_only_tool")).toBe(true);
    expect(customTools.some((t) => t.name === "default_only_tool")).toBe(false);
  });
});
