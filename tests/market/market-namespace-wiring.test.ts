import { describe, it, expect, vi } from "vitest";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createNamespace, listTools } from "@agentbadge/mcp";
import { registerMarketplaceTools } from "@agentbadge/mcp";
import { registerDatasetTools } from "@agentbadge/mcp";

describe("SLICE-72-5: market namespace wiring", () => {
  it("registerMarketplaceTools(ns) registers into market namespace", () => {
    const ns = createNamespace("market-test-1");
    registerMarketplaceTools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(6);
    expect(tools.some((t) => t.name === "post_task")).toBe(true);
    expect(tools.some((t) => t.name === "list_tasks")).toBe(true);
    expect(tools.some((t) => t.name === "claim_task")).toBe(true);
    expect(tools.some((t) => t.name === "deliver_result")).toBe(true);
    expect(tools.some((t) => t.name === "prepare_payment")).toBe(true);
    expect(tools.some((t) => t.name === "complete_task")).toBe(true);
  });

  it("registerDatasetTools(ns) registers into market namespace", () => {
    const ns = createNamespace("market-test-2");
    registerDatasetTools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(2);
    expect(tools.some((t) => t.name === "download_dataset")).toBe(true);
    expect(tools.some((t) => t.name === "upload_result")).toBe(true);
  });

  it("both together register ~8 tools in market namespace", () => {
    const ns = createNamespace("market-test-all");
    registerMarketplaceTools(ns);
    registerDatasetTools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(8);
  });

  it("calling without ns still works (backward compat)", () => {
    registerMarketplaceTools();
    registerDatasetTools();
    const tools = listTools();
    expect(tools.some((t) => t.name === "post_task")).toBe(true);
    expect(tools.some((t) => t.name === "download_dataset")).toBe(true);
  });

  it("market namespace tools do NOT appear in a different namespace", () => {
    const marketNs = createNamespace("market-iso");
    registerMarketplaceTools(marketNs);
    registerDatasetTools(marketNs);

    const otherNs = createNamespace("other-iso-market");
    otherNs.registerTool("other_tool", "Other", {}, async () => ({
      content: [{ type: "text", text: "other" }],
    }));

    const marketTools = marketNs.listTools();
    const otherTools = otherNs.listTools();

    expect(marketTools.some((t) => t.name === "post_task")).toBe(true);
    expect(otherTools.some((t) => t.name === "post_task")).toBe(false);
    expect(otherTools.some((t) => t.name === "other_tool")).toBe(true);
    expect(marketTools.some((t) => t.name === "other_tool")).toBe(false);
  });
});
