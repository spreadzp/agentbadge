import { describe, it, expect } from "vitest";
import {
  createNamespace,
  registerAuditCatalogTools,
  listTools,
} from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "../src/mcp/compliance-tools";
import { registerParityTools } from "../src/mcp/parity-tools";

describe("SLICE-72-7: Audit namespace wiring", () => {
  it("registerAuditCatalogTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-audit-catalog");
    registerAuditCatalogTools(testNs);
    expect(testNs.listTools().length).toBe(2);
  });

  it("registerComplianceTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-compliance");
    registerComplianceTools(testNs);
    expect(testNs.listTools().length).toBe(1);
  });

  it("registerParityTools(ns) registers tools in the given namespace", () => {
    const testNs = createNamespace("test-parity");
    registerParityTools(testNs);
    expect(testNs.listTools().length).toBe(26);
  });

  it("calling registerAuditCatalogTools() without args still works (backward compat)", () => {
    const before = listTools().length;
    registerAuditCatalogTools();
    const after = listTools().length;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("calling registerComplianceTools() without args still works (backward compat)", () => {
    const before = listTools().length;
    registerComplianceTools();
    const after = listTools().length;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("calling registerParityTools() without args still works (backward compat)", () => {
    const before = listTools().length;
    registerParityTools();
    const after = listTools().length;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("audit namespace has all audit tools (2 audit-catalog + 1 compliance + 26 parity = 29)", () => {
    const auditNs = createNamespace("audit");
    registerAuditCatalogTools(auditNs);
    registerComplianceTools(auditNs);
    registerParityTools(auditNs);
    expect(auditNs.listTools().length).toBe(29);
  });

  it("audit tools do not appear in other namespaces", () => {
    const auditNs = createNamespace("audit");
    registerAuditCatalogTools(auditNs);
    registerComplianceTools(auditNs);
    registerParityTools(auditNs);

    const passportNs = createNamespace("passport4");
    const marketNs = createNamespace("market4");
    const discoveryNs = createNamespace("discovery4");

    const auditToolNames = new Set(auditNs.listTools().map((t) => t.name));

    for (const t of passportNs.listTools()) {
      expect(auditToolNames.has(t.name)).toBe(false);
    }
    for (const t of marketNs.listTools()) {
      expect(auditToolNames.has(t.name)).toBe(false);
    }
    for (const t of discoveryNs.listTools()) {
      expect(auditToolNames.has(t.name)).toBe(false);
    }
  });
});
