import { describe, it, expect, vi } from "vitest";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createNamespace, listTools } from "@agentgate-hedera/mcp";
import { registerAuditCatalogTools } from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "../src/mcp/compliance-tools";
import { registerParityTools } from "../src/mcp/parity-tools";

describe("SLICE-72-7: audit namespace wiring", () => {
  it("registerAuditCatalogTools(ns) registers into audit namespace", () => {
    const ns = createNamespace("audit-test-1");
    registerAuditCatalogTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "get_audit_trail")).toBe(true);
    expect(tools.some((t) => t.name === "get_tier_requirements")).toBe(true);
  });

  it("registerComplianceTools(ns) registers into audit namespace", () => {
    const ns = createNamespace("audit-test-2");
    registerComplianceTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "check_compliance")).toBe(true);
  });

  it("registerParityTools(ns) registers into audit namespace", () => {
    const ns = createNamespace("audit-test-3");
    registerParityTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "get_oauth_authorization_server")).toBe(true);
    expect(tools.some((t) => t.name === "resolve_did")).toBe(true);
    expect(tools.some((t) => t.name === "get_feed")).toBe(true);
    expect(tools.some((t) => t.name === "get_services_info")).toBe(true);
  });

  it("all together register 20+ tools in audit namespace", () => {
    const ns = createNamespace("audit-test-all");
    registerAuditCatalogTools(ns);
    registerComplianceTools(ns);
    registerParityTools(ns);
    const tools = ns.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(20);
  });

  it("calling without ns still works (backward compat)", () => {
    registerAuditCatalogTools();
    registerComplianceTools();
    registerParityTools();
    const tools = listTools();
    expect(tools.some((t) => t.name === "get_audit_trail")).toBe(true);
    expect(tools.some((t) => t.name === "check_compliance")).toBe(true);
    expect(tools.some((t) => t.name === "get_oauth_authorization_server")).toBe(true);
  });

  it("audit namespace tools do NOT appear in a different namespace", () => {
    const auditNs = createNamespace("audit-iso");
    registerAuditCatalogTools(auditNs);
    registerComplianceTools(auditNs);
    registerParityTools(auditNs);

    const otherNs = createNamespace("other-iso-audit");
    otherNs.registerTool("other_tool", "Other", {}, async () => ({
      content: [{ type: "text", text: "other" }],
    }));

    const auditTools = auditNs.listTools();
    const otherTools = otherNs.listTools();

    expect(auditTools.some((t) => t.name === "check_compliance")).toBe(true);
    expect(otherTools.some((t) => t.name === "check_compliance")).toBe(false);
    expect(otherTools.some((t) => t.name === "other_tool")).toBe(true);
    expect(auditTools.some((t) => t.name === "other_tool")).toBe(false);
  });
});
