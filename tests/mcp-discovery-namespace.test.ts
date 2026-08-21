import { describe, it, expect } from "vitest";
import {
  createNamespace,
  registerDiscoveryTools,
  registerDirectoryTools,
  registerGuideTools,
  registerA2ATools,
  listTools,
} from "@agentgate-hedera/mcp";

describe("SLICE-72-6: Discovery namespace wiring", () => {
  it("registerDiscoveryTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-discovery");
    registerDiscoveryTools(testNs);
    expect(testNs.listTools().length).toBe(4);
  });

  it("registerDirectoryTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-directory");
    registerDirectoryTools(testNs);
    expect(testNs.listTools().length).toBe(2);
  });

  it("registerGuideTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-guide");
    registerGuideTools(testNs);
    expect(testNs.listTools().length).toBe(2);
  });

  it("registerA2ATools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-a2a");
    registerA2ATools(testNs);
    expect(testNs.listTools().length).toBe(4);
  });

  it("calling without args still works (backward compat)", () => {
    const before = listTools().length;
    registerDiscoveryTools();
    registerDirectoryTools();
    registerGuideTools();
    registerA2ATools();
    const after = listTools().length;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("discovery namespace has 12 tools (4 discovery + 2 directory + 2 guide + 4 a2a)", () => {
    const discoveryNs = createNamespace("discovery");
    registerDiscoveryTools(discoveryNs);
    registerDirectoryTools(discoveryNs);
    registerGuideTools(discoveryNs);
    registerA2ATools(discoveryNs);
    expect(discoveryNs.listTools().length).toBe(12);
  });

  it("discovery tools do not appear in other namespaces", () => {
    const discoveryNs = createNamespace("discovery");
    registerDiscoveryTools(discoveryNs);
    registerDirectoryTools(discoveryNs);
    registerGuideTools(discoveryNs);
    registerA2ATools(discoveryNs);

    const passportNs = createNamespace("passport3");
    const marketNs = createNamespace("market3");
    const auditNs = createNamespace("audit3");

    const discoveryToolNames = new Set(discoveryNs.listTools().map((t) => t.name));

    for (const t of passportNs.listTools()) {
      expect(discoveryToolNames.has(t.name)).toBe(false);
    }
    for (const t of marketNs.listTools()) {
      expect(discoveryToolNames.has(t.name)).toBe(false);
    }
    for (const t of auditNs.listTools()) {
      expect(discoveryToolNames.has(t.name)).toBe(false);
    }
  });
});
