import { describe, it, expect } from "vitest";
import {
  createNamespace,
  getNamespace,
  listAllNamespaces,
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
import { registerComplianceTools } from "../../src/mcp/compliance-tools";
import { registerParityTools } from "../../src/mcp/parity-tools";

function setupAllNamespaces() {
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

  const allNs = createNamespace("all");
  registerAllTools(allNs);
  registerComplianceTools(allNs);
  registerParityTools(allNs);
}

describe("SLICE-72-10: MCP Namespace unit tests", () => {
  it("passport namespace has 16 tools (7 passport + 5 signing + 4 escrow)", () => {
    setupAllNamespaces();
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

  it("all namespace has 65 tools (aggregator)", () => {
    setupAllNamespaces();
    const ns = getNamespace("all");
    expect(ns).toBeDefined();
    expect(ns!.listTools().length).toBe(65);
  });

  it("no tool appears in two namespaces (passport, market, discovery, audit are disjoint)", () => {
    setupAllNamespaces();
    const nsNames = ["passport", "market", "discovery", "audit"] as const;
    const seen = new Map<string, string>();

    for (const nsName of nsNames) {
      const ns = getNamespace(nsName);
      expect(ns).toBeDefined();
      for (const tool of ns!.listTools()) {
        if (seen.has(tool.name)) {
          throw new Error(
            `Tool '${tool.name}' appears in both '${seen.get(tool.name)}' and '${nsName}'`,
          );
        }
        seen.set(tool.name, nsName);
      }
    }

    // 16 + 8 + 12 + 29 = 65 unique tools
    expect(seen.size).toBe(65);
  });

  it("total tools across namespaces equals 65 (no regression)", () => {
    setupAllNamespaces();
    const nsNames = ["passport", "market", "discovery", "audit"] as const;
    let total = 0;
    for (const nsName of nsNames) {
      total += getNamespace(nsName)!.listTools().length;
    }
    expect(total).toBe(65);
  });

  it("all namespace contains every tool from every other namespace", () => {
    setupAllNamespaces();
    const allNs = getNamespace("all");
    expect(allNs).toBeDefined();
    const allToolNames = new Set(allNs!.listTools().map((t) => t.name));

    const nsNames = ["passport", "market", "discovery", "audit"] as const;
    for (const nsName of nsNames) {
      const ns = getNamespace(nsName);
      for (const tool of ns!.listTools()) {
        expect(allToolNames.has(tool.name)).toBe(true);
      }
    }
  });

  it("listAllNamespaces includes all 5 namespaces (passport, market, discovery, audit, all)", () => {
    setupAllNamespaces();
    const names = listAllNamespaces();
    expect(names).toContain("passport");
    expect(names).toContain("market");
    expect(names).toContain("discovery");
    expect(names).toContain("audit");
    expect(names).toContain("all");
  });

  it("every tool has a non-empty name and description", () => {
    setupAllNamespaces();
    const nsNames = ["passport", "market", "discovery", "audit", "all"] as const;
    for (const nsName of nsNames) {
      const ns = getNamespace(nsName);
      expect(ns).toBeDefined();
      for (const tool of ns!.listTools()) {
        expect(tool.name).toBeTruthy();
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("every tool has a valid inputSchema", () => {
    setupAllNamespaces();
    const nsNames = ["passport", "market", "discovery", "audit"] as const;
    for (const nsName of nsNames) {
      const ns = getNamespace(nsName);
      expect(ns).toBeDefined();
      for (const tool of ns!.listTools()) {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe("object");
      }
    }
  });
});
