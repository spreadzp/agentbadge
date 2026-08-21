import { describe, it, expect } from "vitest";
import {
  createNamespace,
  getNamespace,
  registerMarketplaceTools,
  registerDatasetTools,
  listTools,
} from "@agentgate-hedera/mcp";

describe("SLICE-72-5: Market namespace wiring", () => {
  it("registerMarketplaceTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-marketplace");
    const beforeCount = testNs.listTools().length;
    registerMarketplaceTools(testNs);
    const afterCount = testNs.listTools().length;
    expect(afterCount).toBeGreaterThan(beforeCount);
    expect(afterCount).toBe(6);
  });

  it("registerDatasetTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-dataset");
    const beforeCount = testNs.listTools().length;
    registerDatasetTools(testNs);
    const afterCount = testNs.listTools().length;
    expect(afterCount).toBeGreaterThan(beforeCount);
    expect(afterCount).toBe(2);
  });

  it("calling registerMarketplaceTools() without args still works (backward compat)", () => {
    const globalBefore = listTools().length;
    registerMarketplaceTools();
    const globalAfter = listTools().length;
    expect(globalAfter).toBeGreaterThanOrEqual(globalBefore);
  });

  it("calling registerDatasetTools() without args still works (backward compat)", () => {
    const globalBefore = listTools().length;
    registerDatasetTools();
    const globalAfter = listTools().length;
    expect(globalAfter).toBeGreaterThanOrEqual(globalBefore);
  });

  it("market namespace has ~8 tools (6 marketplace + 2 dataset)", () => {
    const marketNs = createNamespace("market");
    registerMarketplaceTools(marketNs);
    registerDatasetTools(marketNs);
    const tools = marketNs.listTools();
    expect(tools.length).toBe(8);
  });

  it("market tools do not appear in other namespaces", () => {
    const marketNs = createNamespace("market");
    registerMarketplaceTools(marketNs);
    registerDatasetTools(marketNs);

    const passportNs = createNamespace("passport2");
    const discoveryNs = createNamespace("discovery2");
    const auditNs = createNamespace("audit2");

    const marketToolNames = new Set(marketNs.listTools().map((t) => t.name));

    for (const t of passportNs.listTools()) {
      expect(marketToolNames.has(t.name)).toBe(false);
    }
    for (const t of discoveryNs.listTools()) {
      expect(marketToolNames.has(t.name)).toBe(false);
    }
    for (const t of auditNs.listTools()) {
      expect(marketToolNames.has(t.name)).toBe(false);
    }
  });
});
