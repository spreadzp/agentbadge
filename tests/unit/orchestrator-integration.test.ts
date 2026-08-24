import { describe, it, expect } from "vitest";
import { DEFAULT_RESOURCES } from "../../src/agent-readiness/scanner/orchestrator";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";

describe("SLICE-48-20: Orchestrator integration", () => {
  it("DEFAULT_RESOURCES includes all new fetcher sources", () => {
    const resources = [...DEFAULT_RESOURCES];
    expect(resources).toContain("mcp_probe");
    expect(resources).toContain("homepage_meta");
    expect(resources).toContain("infrastructure");
    expect(resources).toContain("a2a");
    expect(resources).toContain("identity");
    expect(resources).toContain("bot_auth");
  });

  it("ruleset has at least 100 rules total", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBeGreaterThanOrEqual(100);
  });

  it("ruleset has AB-015 through AB-060", () => {
    const newRules = AGENT_READINESS_RULESET.rules.filter(
      (r) => r.rule_id >= "AB-015" && r.rule_id <= "AB-060",
    );
    expect(newRules).toHaveLength(46);
  });

  it("some rules have counted_in_score: false", () => {
    const optional = AGENT_READINESS_RULESET.rules.filter(
      (r) => r.counted_in_score === false,
    );
    expect(optional.length).toBeGreaterThan(0);
  });
});
