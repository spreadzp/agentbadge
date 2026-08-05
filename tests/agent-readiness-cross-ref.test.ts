import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../src/agent-readiness/ruleset";
import { categoryEnum } from "../src/agent-readiness/shared.schema";
import { cleanReport } from "./fixtures/agent-readiness-report-clean";
import { problemReport } from "./fixtures/agent-readiness-report-problem";

describe("agent-readiness cross-reference integrity", () => {
  it("report fixture rule_ids all exist in AGENT_READINESS_RULESET", () => {
    const rulesetIds = new Set(AGENT_READINESS_RULESET.rules.map((r) => r.rule_id));
    for (const assertion of cleanReport.assertions) {
      expect(rulesetIds.has(assertion.rule_id), `${assertion.rule_id} should be in ruleset`).toBe(true);
    }
    for (const assertion of problemReport.assertions) {
      expect(rulesetIds.has(assertion.rule_id), `${assertion.rule_id} should be in ruleset`).toBe(true);
    }
  });

  it("report fixture ruleset.name matches AGENT_READINESS_RULESET.name", () => {
    expect(cleanReport.ruleset.name).toBe(AGENT_READINESS_RULESET.name);
    expect(problemReport.ruleset.name).toBe(AGENT_READINESS_RULESET.name);
  });

  it("report fixture ruleset.version matches AGENT_READINESS_RULESET.version", () => {
    expect(cleanReport.ruleset.version).toBe(AGENT_READINESS_RULESET.version);
    expect(problemReport.ruleset.version).toBe(AGENT_READINESS_RULESET.version);
  });

  it("report fixture category names match categoryEnum values", () => {
    const validCategories = new Set(categoryEnum.options);
    for (const assertion of cleanReport.assertions) {
      expect(validCategories.has(assertion.category), `${assertion.category} is a valid category`).toBe(true);
    }
    for (const assertion of problemReport.assertions) {
      expect(validCategories.has(assertion.category), `${assertion.category} is a valid category`).toBe(true);
    }
  });

  it("ruleset rule categories match categoryEnum values", () => {
    const validCategories = new Set(categoryEnum.options);
    for (const rule of AGENT_READINESS_RULESET.rules) {
      expect(validCategories.has(rule.category), `${rule.category} is a valid category`).toBe(true);
    }
  });
});
