import { describe, it, expect, vi } from "vitest";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createNamespace, listTools } from "@agentgate-hedera/mcp";
import { registerDiscoveryTools } from "@agentgate-hedera/mcp";
import { registerDirectoryTools } from "@agentgate-hedera/mcp";
import { registerGuideTools } from "@agentgate-hedera/mcp";
import { registerA2ATools } from "@agentgate-hedera/mcp";

describe("SLICE-72-6: discovery namespace wiring", () => {
  it("registerDiscoveryTools(ns) registers into discovery namespace", () => {
    const ns = createNamespace("discovery-test-1");
    registerDiscoveryTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "get_agent_card")).toBe(true);
    expect(tools.some((t) => t.name === "search_agents")).toBe(true);
    expect(tools.some((t) => t.name === "get_server_info")).toBe(true);
    expect(tools.some((t) => t.name === "get_ai_sitemap")).toBe(true);
  });

  it("registerDirectoryTools(ns) registers into discovery namespace", () => {
    const ns = createNamespace("discovery-test-2");
    registerDirectoryTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "register_agent")).toBe(true);
    expect(tools.some((t) => t.name === "find_agents")).toBe(true);
  });

  it("registerGuideTools(ns) registers into discovery namespace", () => {
    const ns = createNamespace("discovery-test-3");
    registerGuideTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "get_guide")).toBe(true);
    expect(tools.some((t) => t.name === "list_guides")).toBe(true);
  });

  it("registerA2ATools(ns) registers into discovery namespace", () => {
    const ns = createNamespace("discovery-test-4");
    registerA2ATools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "send_message")).toBe(true);
    expect(tools.some((t) => t.name === "send_message_with_key")).toBe(true);
    expect(tools.some((t) => t.name === "get_inbox")).toBe(true);
    expect(tools.some((t) => t.name === "get_conversation")).toBe(true);
  });

  it("all together register ~12 tools in discovery namespace", () => {
    const ns = createNamespace("discovery-test-all");
    registerDiscoveryTools(ns);
    registerDirectoryTools(ns);
    registerGuideTools(ns);
    registerA2ATools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(12);
  });

  it("calling without ns still works (backward compat)", () => {
    registerDiscoveryTools();
    registerDirectoryTools();
    registerGuideTools();
    registerA2ATools();
    const tools = listTools();
    expect(tools.some((t) => t.name === "get_agent_card")).toBe(true);
    expect(tools.some((t) => t.name === "register_agent")).toBe(true);
    expect(tools.some((t) => t.name === "get_guide")).toBe(true);
    expect(tools.some((t) => t.name === "send_message")).toBe(true);
  });

  it("discovery namespace tools do NOT appear in a different namespace", () => {
    const discoveryNs = createNamespace("discovery-iso");
    registerDiscoveryTools(discoveryNs);
    registerDirectoryTools(discoveryNs);
    registerGuideTools(discoveryNs);
    registerA2ATools(discoveryNs);

    const otherNs = createNamespace("other-iso-discovery");
    otherNs.registerTool("other_tool", "Other", {}, async () => ({
      content: [{ type: "text", text: "other" }],
    }));

    const discoveryTools = discoveryNs.listTools();
    const otherTools = otherNs.listTools();

    expect(discoveryTools.some((t) => t.name === "get_agent_card")).toBe(true);
    expect(otherTools.some((t) => t.name === "get_agent_card")).toBe(false);
    expect(otherTools.some((t) => t.name === "other_tool")).toBe(true);
    expect(discoveryTools.some((t) => t.name === "other_tool")).toBe(false);
  });
});
