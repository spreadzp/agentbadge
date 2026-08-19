import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB074 } from "../../../src/agent-readiness/rules/AB074";
import { AB075 } from "../../../src/agent-readiness/rules/AB075";
import { AB085 } from "../../../src/agent-readiness/rules/AB085";
import { AB086 } from "../../../src/agent-readiness/rules/AB086";

describe("SLICE-69-2: A2A Agent Card & MCP Gap Rules", () => {
  it("AB-074: A2A Agent Card published", () => {
    expect(AB074.rule_id).toBe("AB-074");
    expect(AB074.name).toBe("A2A Agent Card published");
    expect(AB074.category).toBe("actionability");
    expect(AB074.severity).toBe("medium");
    expect(AB074.counted_in_score).toBe(true);
    expect(AB074.check.type).toBe("http_fetch");
    expect(AB074.check.target).toBe("/.well-known/agent-card.json");
    expect(AB074.check.sources).toContain("a2a");
    expect(AB074.fix.eligible).toBe(true);
    expect(AB074.fix.type).toBe("assisted");
  });

  it("AB-075: A2A Agent Card verified", () => {
    expect(AB075.rule_id).toBe("AB-075");
    expect(AB075.name).toBe("A2A Agent Card verified");
    expect(AB075.category).toBe("actionability");
    expect(AB075.severity).toBe("medium");
    expect(AB075.counted_in_score).toBe(true);
    expect(AB075.check.type).toBe("schema_validation");
    expect(AB075.check.target).toBe("/.well-known/agent-card.json");
    expect(AB075.check.sources).toContain("a2a");
    expect(AB075.fix.eligible).toBe(true);
    expect(AB075.fix.type).toBe("assisted");
  });

  it("AB-085: MCP server name present", () => {
    expect(AB085.rule_id).toBe("AB-085");
    expect(AB085.name).toBe("MCP server name present");
    expect(AB085.category).toBe("actionability");
    expect(AB085.severity).toBe("medium");
    expect(AB085.counted_in_score).toBe(true);
    expect(AB085.check.type).toBe("json_rpc");
    expect(AB085.check.target).toBe("/mcp");
    expect(AB085.check.sources).toContain("mcp_probe");
    expect(AB085.fix.eligible).toBe(true);
    expect(AB085.fix.type).toBe("assisted");
  });

  it("AB-086: MCP auth discovery resolves", () => {
    expect(AB086.rule_id).toBe("AB-086");
    expect(AB086.name).toBe("MCP auth discovery resolves");
    expect(AB086.category).toBe("actionability");
    expect(AB086.severity).toBe("medium");
    expect(AB086.counted_in_score).toBe(true);
    expect(AB086.check.type).toBe("http_probe");
    expect(AB086.check.sources).toContain("mcp_probe");
    expect(AB086.fix.eligible).toBe(false);
    expect(AB086.fix.type).toBe("assisted");
  });

  it("all 4 rules validate against schema", () => {
    for (const rule of [AB074, AB075, AB085, AB086]) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `${rule.rule_id} should validate`).toBe(true);
    }
  });

  it("all 4 rules registered in ruleset", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(ids).toContain("AB-074");
    expect(ids).toContain("AB-075");
    expect(ids).toContain("AB-085");
    expect(ids).toContain("AB-086");
  });

  it("ruleset has 80 total rules", () => {
    expect(AGENT_READINESS_RULESET.rules).toHaveLength(80);
  });

  it("ruleset version is 1.6.0", () => {
    expect(AGENT_READINESS_RULESET.version).toBe("1.6.0");
  });
});
