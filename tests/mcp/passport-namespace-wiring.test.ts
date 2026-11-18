import { describe, it, expect, vi } from "vitest";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createNamespace, listTools } from "@agentbadge/mcp";
import { registerPassportTools } from "@agentbadge/mcp";
import { registerSigningTools } from "@agentbadge/mcp";
import { registerEscrowTools } from "@agentbadge/mcp";

describe("SLICE-72-4: passport namespace wiring", () => {
  it("registerPassportTools(ns) registers into passport namespace", () => {
    const ns = createNamespace("passport-test-1");
    registerPassportTools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(7);
    expect(tools.some((t) => t.name === "request_passport")).toBe(true);
    expect(tools.some((t) => t.name === "upload_image")).toBe(true);
    expect(tools.some((t) => t.name === "verify_passport")).toBe(true);
  });

  it("registerSigningTools(ns) registers into passport namespace", () => {
    const ns = createNamespace("passport-test-2");
    registerSigningTools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(5);
    expect(tools.some((t) => t.name === "sign_transaction")).toBe(true);
    expect(tools.some((t) => t.name === "complete_task_with_key")).toBe(true);
  });

  it("registerEscrowTools(ns) registers into passport namespace", () => {
    const ns = createNamespace("passport-test-3");
    registerEscrowTools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(4);
    expect(tools.some((t) => t.name === "get_escrow_status")).toBe(true);
    expect(tools.some((t) => t.name === "cancel_escrow")).toBe(true);
  });

  it("all three together register ~16 tools in passport namespace", () => {
    const ns = createNamespace("passport-test-all");
    registerPassportTools(ns);
    registerSigningTools(ns);
    registerEscrowTools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(16);
  });

  it("calling without ns still works (backward compat)", () => {
    registerPassportTools();
    registerSigningTools();
    registerEscrowTools();
    const tools = listTools();
    expect(tools.some((t) => t.name === "request_passport")).toBe(true);
    expect(tools.some((t) => t.name === "sign_transaction")).toBe(true);
    expect(tools.some((t) => t.name === "get_escrow_status")).toBe(true);
  });

  it("passport namespace tools do NOT appear in a different namespace", () => {
    const passportNs = createNamespace("passport-iso");
    registerPassportTools(passportNs);

    const otherNs = createNamespace("other-iso");
    otherNs.registerTool("other_tool", "Other", {}, async () => ({
      content: [{ type: "text", text: "other" }],
    }));

    const passportTools = passportNs.listTools();
    const otherTools = otherNs.listTools();

    expect(passportTools.some((t) => t.name === "request_passport")).toBe(true);
    expect(otherTools.some((t) => t.name === "request_passport")).toBe(false);
    expect(otherTools.some((t) => t.name === "other_tool")).toBe(true);
    expect(passportTools.some((t) => t.name === "other_tool")).toBe(false);
  });
});
