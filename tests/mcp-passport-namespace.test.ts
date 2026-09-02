import { describe, it, expect, beforeEach } from "vitest";
import {
  createNamespace,
  getNamespace,
  listAllNamespaces,
  registerPassportTools,
  registerSigningTools,
  registerEscrowTools,
  listTools,
} from "@agentbadge/mcp";

describe("SLICE-72-4: Passport namespace wiring", () => {
  it("registerPassportTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-passport");
    const beforeCount = testNs.listTools().length;
    registerPassportTools(testNs);
    const afterCount = testNs.listTools().length;
    expect(afterCount).toBeGreaterThan(beforeCount);
    expect(afterCount).toBe(7);
  });

  it("registerSigningTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-signing");
    const beforeCount = testNs.listTools().length;
    registerSigningTools(testNs);
    const afterCount = testNs.listTools().length;
    expect(afterCount).toBeGreaterThan(beforeCount);
    expect(afterCount).toBe(5);
  });

  it("registerEscrowTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-escrow");
    const beforeCount = testNs.listTools().length;
    registerEscrowTools(testNs);
    const afterCount = testNs.listTools().length;
    expect(afterCount).toBeGreaterThan(beforeCount);
    expect(afterCount).toBe(4);
  });

  it("calling registerPassportTools() without args still works (backward compat)", () => {
    const globalBefore = listTools().length;
    registerPassportTools();
    const globalAfter = listTools().length;
    expect(globalAfter).toBeGreaterThanOrEqual(globalBefore);
  });

  it("calling registerSigningTools() without args still works (backward compat)", () => {
    const globalBefore = listTools().length;
    registerSigningTools();
    const globalAfter = listTools().length;
    expect(globalAfter).toBeGreaterThanOrEqual(globalBefore);
  });

  it("calling registerEscrowTools() without args still works (backward compat)", () => {
    const globalBefore = listTools().length;
    registerEscrowTools();
    const globalAfter = listTools().length;
    expect(globalAfter).toBeGreaterThanOrEqual(globalBefore);
  });

  it("passport namespace has ~16 tools (7 passport + 5 signing + 4 escrow)", () => {
    const passportNs = createNamespace("passport");
    registerPassportTools(passportNs);
    registerSigningTools(passportNs);
    registerEscrowTools(passportNs);
    const tools = passportNs.listTools();
    expect(tools.length).toBe(16);
  });

  it("passport tools do not appear in other namespaces", () => {
    const passportNs = createNamespace("passport");
    registerPassportTools(passportNs);
    registerSigningTools(passportNs);
    registerEscrowTools(passportNs);

    const marketNs = createNamespace("market");
    const discoveryNs = createNamespace("discovery");
    const auditNs = createNamespace("audit");

    const marketTools = marketNs.listTools();
    const discoveryTools = discoveryNs.listTools();
    const auditTools = auditNs.listTools();

    const passportToolNames = new Set(
      passportNs.listTools().map((t) => t.name),
    );

    for (const t of marketTools) {
      expect(passportToolNames.has(t.name)).toBe(false);
    }
    for (const t of discoveryTools) {
      expect(passportToolNames.has(t.name)).toBe(false);
    }
    for (const t of auditTools) {
      expect(passportToolNames.has(t.name)).toBe(false);
    }
  });
});
