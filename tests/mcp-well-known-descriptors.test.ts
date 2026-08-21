import { describe, it, expect } from "vitest";
import { createNamespace, registerPassportTools, registerSigningTools, registerEscrowTools, registerMarketplaceTools, registerDatasetTools, registerDiscoveryTools, registerDirectoryTools, registerGuideTools, registerA2ATools, registerAuditCatalogTools, getNamespace, listAllNamespaces } from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "../src/mcp/compliance-tools";
import { registerParityTools } from "../src/mcp/parity-tools";

// Ensure namespaces are populated for tests
function setupNamespaces() {
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
}

describe("SLICE-72-8: Well-known namespace descriptors", () => {
  it("passport namespace has 16 tools (7 passport + 5 signing + 4 escrow)", () => {
    setupNamespaces();
    const ns = getNamespace("passport");
    expect(ns).toBeDefined();
    expect(ns!.listTools().length).toBe(16);
  });

  it("market namespace has 8 tools (6 marketplace + 2 dataset)", () => {
    const ns = getNamespace("market");
    expect(ns).toBeDefined();
    expect(ns!.listTools().length).toBe(8);
  });

  it("discovery namespace has 12 tools (4 discovery + 2 directory + 2 guide + 4 a2a)", () => {
    const ns = getNamespace("discovery");
    expect(ns).toBeDefined();
    expect(ns!.listTools().length).toBe(12);
  });

  it("audit namespace has 29 tools (2 audit-catalog + 1 compliance + 26 parity)", () => {
    const ns = getNamespace("audit");
    expect(ns).toBeDefined();
    expect(ns!.listTools().length).toBe(29);
  });

  it("listAllNamespaces returns all 4 namespaces", () => {
    setupNamespaces();
    const names = listAllNamespaces();
    expect(names).toContain("passport");
    expect(names).toContain("market");
    expect(names).toContain("discovery");
    expect(names).toContain("audit");
  });

  it("each namespace descriptor can be built from listTools()", () => {
    setupNamespaces();
    const namespaces = ["passport", "market", "discovery", "audit"] as const;
    for (const nsName of namespaces) {
      const ns = getNamespace(nsName);
      expect(ns).toBeDefined();
      const tools = ns!.listTools();
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(typeof tool.description).toBe("string");
      }
    }
  });

  it("root mcp.json descriptor lists all 4 namespace remotes + /mcp aggregator", () => {
    const remotes = [
      { name: "passport", transport: "http", url: "https://agentbadge.xyz/mcp/passport" },
      { name: "market", transport: "http", url: "https://agentbadge.xyz/mcp/market" },
      { name: "discovery", transport: "http", url: "https://agentbadge.xyz/mcp/discovery" },
      { name: "audit", transport: "http", url: "https://agentbadge.xyz/mcp/audit" },
      { name: "all", transport: "http", url: "https://agentbadge.xyz/mcp" },
    ];
    expect(remotes.length).toBe(5);
    const names = remotes.map((r) => r.name);
    expect(names).toContain("passport");
    expect(names).toContain("market");
    expect(names).toContain("discovery");
    expect(names).toContain("audit");
    expect(names).toContain("all");
  });
});
