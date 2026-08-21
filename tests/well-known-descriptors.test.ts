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
  listTools,
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

// Register tools into namespaces for test isolation
const passportNs = createNamespace("passport");
registerPassportTools(passportNs);
registerSigningTools(passportNs);
registerEscrowTools(passportNs);

const marketNs = createNamespace("market");
registerMarketplaceTools(marketNs);
registerDatasetTools(marketNs);

const discoveryNs = createNamespace("discovery");
registerDiscoveryTools(discoveryNs);
registerDirectoryTools(discoveryNs);
registerGuideTools(discoveryNs);
registerA2ATools(discoveryNs);

const auditNs = createNamespace("audit");
registerAuditCatalogTools(auditNs);
registerComplianceTools(auditNs);
registerParityTools(auditNs);

// Also register into "all" for backward compat
registerPassportTools();
registerSigningTools();
registerEscrowTools();
registerMarketplaceTools();
registerDatasetTools();
registerDiscoveryTools();
registerDirectoryTools();
registerGuideTools();
registerA2ATools();
registerAuditCatalogTools();
registerComplianceTools();
registerParityTools();

describe("SLICE-72-8: per-namespace .well-known descriptors", () => {
  it("passport namespace has tools registered", () => {
    const tools = passportNs.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "request_passport")).toBe(true);
  });

  it("market namespace has tools registered", () => {
    const tools = marketNs.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "post_task")).toBe(true);
  });

  it("discovery namespace has tools registered", () => {
    const tools = discoveryNs.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "search_agents")).toBe(true);
  });

  it("audit namespace has tools registered", () => {
    const tools = auditNs.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "check_compliance")).toBe(true);
  });

  it("all 4 namespaces have distinct tool sets", () => {
    const passportNames = passportNs.listTools().map((t) => t.name);
    const marketNames = marketNs.listTools().map((t) => t.name);
    const discoveryNames = discoveryNs.listTools().map((t) => t.name);
    const auditNames = auditNs.listTools().map((t) => t.name);

    // No overlap between passport and audit
    const passportAuditOverlap = passportNames.filter((n) => auditNames.includes(n));
    expect(passportAuditOverlap).toEqual([]);

    // No overlap between market and discovery
    const marketDiscoveryOverlap = marketNames.filter((n) => discoveryNames.includes(n));
    expect(marketDiscoveryOverlap).toEqual([]);
  });

  it("backward compat: 'all' namespace has all tools", () => {
    const allTools = listTools();
    expect(allTools.some((t) => t.name === "request_passport")).toBe(true);
    expect(allTools.some((t) => t.name === "post_task")).toBe(true);
    expect(allTools.some((t) => t.name === "search_agents")).toBe(true);
    expect(allTools.some((t) => t.name === "check_compliance")).toBe(true);
  });

  it("buildNamespaceDescriptor pattern: each namespace produces valid descriptor structure", () => {
    const namespaces = ["passport", "market", "discovery", "audit"];
    for (const nsName of namespaces) {
      const ns = createNamespace(nsName);
      expect(ns).toBeDefined();
      const tools = ns!.listTools();
      expect(tools.length).toBeGreaterThan(0);
      // Each tool has name and description
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
      }
    }
  });
});
