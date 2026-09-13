import { describe, it, expect } from "vitest";
import { CORE_RULE_IDS, isCoreRule } from "../../../src/agent-readiness/core-rules";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";

describe("SLICE-114-1: Core Rule IDs + isCoreRule helper", () => {
  it("CORE_RULE_IDS has ~20 entries", () => {
    expect(CORE_RULE_IDS.length).toBeGreaterThanOrEqual(18);
    expect(CORE_RULE_IDS.length).toBeLessThanOrEqual(25);
  });

  it("isCoreRule returns true for AB-001", () => {
    expect(isCoreRule("AB-001")).toBe(true);
  });

  it("isCoreRule returns true for AB-052", () => {
    expect(isCoreRule("AB-052")).toBe(true);
  });

  it("isCoreRule returns false for non-core rule AB-005", () => {
    expect(isCoreRule("AB-005")).toBe(false);
  });

  it("isCoreRule returns false for non-existent rule AB-999", () => {
    expect(isCoreRule("AB-999")).toBe(false);
  });

  it("isCoreRule returns false for empty string", () => {
    expect(isCoreRule("")).toBe(false);
  });

  it("all CORE_RULE_IDS exist in RULE_DESCRIPTIONS", () => {
    const allRuleIds = new Set(RULE_DESCRIPTIONS.map((r) => r.rule_id));
    for (const id of CORE_RULE_IDS) {
      expect(allRuleIds.has(id)).toBe(true);
    }
  });

  it("CORE_RULE_IDS has no duplicates", () => {
    const unique = new Set(CORE_RULE_IDS);
    expect(unique.size).toBe(CORE_RULE_IDS.length);
  });

  it("CORE_RULE_IDS are all valid format (AB-XXX)", () => {
    for (const id of CORE_RULE_IDS) {
      expect(id).toMatch(/^AB-\d{3}$/);
    }
  });
});
