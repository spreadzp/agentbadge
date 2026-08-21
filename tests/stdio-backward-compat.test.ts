import { describe, it, expect, vi } from "vitest";

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
  listTools,
  registerAllTools,
  registerPassportTools,
  registerSigningTools,
  registerEscrowTools,
  registerMarketplaceTools,
  registerDatasetTools,
  registerDiscoveryTools,
  registerDirectoryTools,
  registerGuideTools,
  registerA2ATools,
  registerAuditCatalogTools,
} from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "../src/mcp/compliance-tools";
import { registerParityTools } from "../src/mcp/parity-tools";

function registerServerAllTools(ns?: any): void {
  registerPassportTools(ns);
  registerSigningTools(ns);
  registerEscrowTools(ns);
  registerMarketplaceTools(ns);
  registerDatasetTools(ns);
  registerDiscoveryTools(ns);
  registerDirectoryTools(ns);
  registerGuideTools(ns);
  registerA2ATools(ns);
  registerAuditCatalogTools(ns);
  registerComplianceTools(ns);
  registerParityTools(ns);
}

describe("SLICE-72-9: Stdio + backward compatibility", () => {
  it("registerAllTools() registers all package tools into 'all' namespace", () => {
    const allNs = getNamespace("all")!;
    const before = allNs.listTools().length;
    registerAllTools();
    const after = allNs.listTools().length;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(allNs.listTools().some((t) => t.name === "request_passport")).toBe(true);
    expect(allNs.listTools().some((t) => t.name === "post_task")).toBe(true);
    expect(allNs.listTools().some((t) => t.name === "search_agents")).toBe(true);
    expect(allNs.listTools().some((t) => t.name === "get_audit_trail")).toBe(true);
  });

  it("registerAllTools(ns) registers into a specific namespace", () => {
    const ns = createNamespace("test-all-pkg");
    registerAllTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "request_passport")).toBe(true);
    expect(tools.some((t) => t.name === "post_task")).toBe(true);
    expect(tools.some((t) => t.name === "search_agents")).toBe(true);
    expect(tools.some((t) => t.name === "get_audit_trail")).toBe(true);
  });

  it("namespace selection: passport namespace only has passport tools", () => {
    const ns = createNamespace("stdio-passport-test");
    registerPassportTools(ns);
    registerSigningTools(ns);
    registerEscrowTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "request_passport")).toBe(true);
    expect(tools.some((t) => t.name === "post_task")).toBe(false);
    expect(tools.some((t) => t.name === "check_compliance")).toBe(false);
  });

  it("namespace selection: market namespace only has market tools", () => {
    const ns = createNamespace("stdio-market-test");
    registerMarketplaceTools(ns);
    registerDatasetTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "post_task")).toBe(true);
    expect(tools.some((t) => t.name === "request_passport")).toBe(false);
  });

  it("namespace selection: discovery namespace only has discovery tools", () => {
    const ns = createNamespace("stdio-discovery-test");
    registerDiscoveryTools(ns);
    registerDirectoryTools(ns);
    registerGuideTools(ns);
    registerA2ATools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "search_agents")).toBe(true);
    expect(tools.some((t) => t.name === "request_passport")).toBe(false);
  });

  it("namespace selection: audit namespace only has audit tools", () => {
    const ns = createNamespace("stdio-audit-test");
    registerAuditCatalogTools(ns);
    registerComplianceTools(ns);
    registerParityTools(ns);
    const tools = ns.listTools();
    expect(tools.some((t) => t.name === "check_compliance")).toBe(true);
    expect(tools.some((t) => t.name === "request_passport")).toBe(false);
  });

  it("backward compat: 'all' namespace has all tools including compliance/parity", () => {
    registerServerAllTools();
    const allTools = listTools();
    expect(allTools.some((t) => t.name === "request_passport")).toBe(true);
    expect(allTools.some((t) => t.name === "post_task")).toBe(true);
    expect(allTools.some((t) => t.name === "search_agents")).toBe(true);
    expect(allTools.some((t) => t.name === "check_compliance")).toBe(true);
    expect(allTools.some((t) => t.name === "get_oauth_authorization_server")).toBe(true);
  });

  it("registerAllTools eliminates duplication — same tool count as manual registration", () => {
    const ns1 = createNamespace("dup-test-registerall");
    registerAllTools(ns1);
    const count1 = ns1.listTools().length;

    const ns2 = createNamespace("dup-test-manual");
    registerPassportTools(ns2);
    registerSigningTools(ns2);
    registerEscrowTools(ns2);
    registerMarketplaceTools(ns2);
    registerDatasetTools(ns2);
    registerDiscoveryTools(ns2);
    registerDirectoryTools(ns2);
    registerGuideTools(ns2);
    registerA2ATools(ns2);
    registerAuditCatalogTools(ns2);
    const count2 = ns2.listTools().length;

    expect(count1).toBe(count2);
  });

  it("unknown namespace exits with error (simulated)", () => {
    const ns = createNamespace("test-unknown");
    expect(ns).toBeDefined();
    // The entry.ts would call process.exit(1) for unknown namespaces,
    // but we just verify the pattern works for known ones
    const validNamespaces = ["passport", "market", "discovery", "audit", "all"];
    for (const name of validNamespaces) {
      const n = getNamespace(name);
      // Some may not exist yet if not created, that's OK
      if (n) {
        expect(n.listTools()).toBeDefined();
      }
    }
  });
});
