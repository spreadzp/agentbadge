import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB083 } from "../../../src/agent-readiness/rules/AB083";
import { AB084 } from "../../../src/agent-readiness/rules/AB084";
import { AB087 } from "../../../src/agent-readiness/rules/AB087";
import { AB089 } from "../../../src/agent-readiness/rules/AB089";
import { AB090 } from "../../../src/agent-readiness/rules/AB090";
import { AB091 } from "../../../src/agent-readiness/rules/AB091";
import { AB092 } from "../../../src/agent-readiness/rules/AB092";

describe("SLICE-69-5: Homepage Meta & Robots Rules", () => {
  it("AB-083: JSON-LD structured data present", () => {
    expect(AB083.rule_id).toBe("AB-083");
    expect(AB083.name).toBe("JSON-LD structured data present");
    expect(AB083.category).toBe("discovery");
    expect(AB083.severity).toBe("medium");
    expect(AB083.counted_in_score).toBe(true);
    expect(AB083.check.type).toBe("content_parse");
    expect(AB083.check.target).toBe("/");
    expect(AB083.check.sources).toContain("homepage_meta");
    expect(AB083.fix.eligible).toBe(true);
    expect(AB083.fix.type).toBe("deterministic");
  });

  it("AB-084: Organization JSON-LD with sameAs", () => {
    expect(AB084.rule_id).toBe("AB-084");
    expect(AB084.name).toBe("Organization JSON-LD with sameAs");
    expect(AB084.category).toBe("discovery");
    expect(AB084.severity).toBe("medium");
    expect(AB084.counted_in_score).toBe(true);
    expect(AB084.check.type).toBe("content_parse");
    expect(AB084.check.target).toBe("/");
    expect(AB084.check.sources).toContain("homepage_meta");
    expect(AB084.fix.eligible).toBe(true);
    expect(AB084.fix.type).toBe("assisted");
  });

  it("AB-087: Google-Extended not blocked in robots.txt", () => {
    expect(AB087.rule_id).toBe("AB-087");
    expect(AB087.name).toBe("Google-Extended not blocked in robots.txt");
    expect(AB087.category).toBe("discovery");
    expect(AB087.severity).toBe("medium");
    expect(AB087.counted_in_score).toBe(true);
    expect(AB087.check.type).toBe("content_parse");
    expect(AB087.check.target).toBe("/robots.txt");
    expect(AB087.check.sources).toContain("robots");
    expect(AB087.fix.eligible).toBe(true);
    expect(AB087.fix.type).toBe("deterministic");
  });

  it("AB-089: og:image declared in meta", () => {
    expect(AB089.rule_id).toBe("AB-089");
    expect(AB089.name).toBe("og:image declared in meta");
    expect(AB089.category).toBe("discovery");
    expect(AB089.severity).toBe("low");
    expect(AB089.counted_in_score).toBe(true);
    expect(AB089.check.type).toBe("content_parse");
    expect(AB089.check.target).toBe("/");
    expect(AB089.check.sources).toContain("homepage_meta");
    expect(AB089.fix.eligible).toBe(true);
    expect(AB089.fix.type).toBe("deterministic");
  });

  it("AB-090: twitter:card set", () => {
    expect(AB090.rule_id).toBe("AB-090");
    expect(AB090.name).toBe("twitter:card set");
    expect(AB090.category).toBe("discovery");
    expect(AB090.severity).toBe("low");
    expect(AB090.counted_in_score).toBe(true);
    expect(AB090.check.type).toBe("content_parse");
    expect(AB090.check.target).toBe("/");
    expect(AB090.check.sources).toContain("homepage_meta");
    expect(AB090.fix.eligible).toBe(true);
    expect(AB090.fix.type).toBe("deterministic");
  });

  it("AB-091: Favicon PNG available", () => {
    expect(AB091.rule_id).toBe("AB-091");
    expect(AB091.name).toBe("Favicon PNG available");
    expect(AB091.category).toBe("discovery");
    expect(AB091.severity).toBe("low");
    expect(AB091.counted_in_score).toBe(true);
    expect(AB091.check.type).toBe("http_fetch");
    expect(AB091.check.target).toBe("/favicon.png");
    expect(AB091.check.sources).toContain("favicon");
    expect(AB091.fix.eligible).toBe(true);
    expect(AB091.fix.type).toBe("deterministic");
  });

  it("AB-092: Schema.org types valid", () => {
    expect(AB092.rule_id).toBe("AB-092");
    expect(AB092.name).toBe("Schema.org types valid");
    expect(AB092.category).toBe("documentation");
    expect(AB092.severity).toBe("low");
    expect(AB092.counted_in_score).toBe(true);
    expect(AB092.check.type).toBe("schema_validation");
    expect(AB092.check.target).toBe("/");
    expect(AB092.check.sources).toContain("homepage_meta");
    expect(AB092.fix.eligible).toBe(true);
    expect(AB092.fix.type).toBe("assisted");
  });

  it("all 7 rules validate against schema", () => {
    for (const rule of [AB083, AB084, AB087, AB089, AB090, AB091, AB092]) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `${rule.rule_id} should validate`).toBe(true);
    }
  });

  it("all 7 rules have valid rule definitions", () => {
    const ids = [AB083.rule_id, AB084.rule_id, AB087.rule_id, AB089.rule_id, AB090.rule_id, AB091.rule_id, AB092.rule_id];
    expect(ids).toEqual(["AB-083", "AB-084", "AB-087", "AB-089", "AB-090", "AB-091", "AB-092"]);
  });

  it("ruleset has at least 100 total rules", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBeGreaterThanOrEqual(100);
  });

  it("ruleset version is 2.0.0", () => {
    expect(AGENT_READINESS_RULESET.version).toBe("2.0.0");
  });
});
