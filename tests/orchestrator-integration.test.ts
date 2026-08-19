import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../src/agent-readiness/ruleset";
import { DEFAULT_RESOURCES } from "../src/agent-readiness/scanner/orchestrator";

describe("Orchestrator integration", () => {
  it("ruleset has 76 rules", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBe(76);
  });

  it("DEFAULT_RESOURCES includes all new fetcher keys", () => {
    const resourceNames = DEFAULT_RESOURCES as readonly string[];
    expect(resourceNames).toContain("content_negotiation");
    expect(resourceNames).toContain("x402");
    expect(resourceNames).toContain("openapi_standard");
    expect(resourceNames).toContain("skill");
    expect(resourceNames).toContain("agents_txt");
    expect(resourceNames).toContain("webmcp");
    expect(resourceNames).toContain("llms_full");
    expect(resourceNames).toContain("rss_feed");
  });

  it("ruleset covers all expected categories", () => {
    const categories = new Set(AGENT_READINESS_RULESET.rules.map((r) => r.category));
    expect(categories.has("content_negotiation")).toBe(true);
    expect(categories.has("payments")).toBe(true);
    expect(categories.has("openapi")).toBe(true);
    expect(categories.has("machine_readable")).toBe(true);
    expect(categories.has("skills")).toBe(true);
    expect(categories.has("infrastructure")).toBe(true);
    expect(categories.has("agents_txt")).toBe(true);
    expect(categories.has("webmcp")).toBe(true);
    expect(categories.has("bazaar")).toBe(true);
    expect(categories.has("documentation")).toBe(true);
  });

  it("all rules have unique rule_ids", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all rules have counted_in_score defined", () => {
    for (const rule of AGENT_READINESS_RULESET.rules) {
      expect(rule.counted_in_score).toBeDefined();
      expect(typeof rule.counted_in_score).toBe("boolean");
    }
  });
});
