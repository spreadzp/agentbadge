import { describe, it, expect } from "vitest";
import { scanDomain } from "../../src/agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../src/agent-readiness/rule-engine/rule-engine";
import { runScoringEngine } from "../../src/agent-readiness/scoring/scoring-engine";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";

/**
 * SLICE-49-13: E2E test — isitagentready.com score >= 80
 *
 * Scans agentbadge.xyz (or E2E_TARGET_URL) with our own CLI scanner
 * and verifies all AB-061..AB-069 rules pass and overall score >= 80.
 */

const TARGET_URL = process.env.E2E_TARGET_URL ?? "https://agentbadge.xyz";

const SCORING_MANIFEST = {
  name: AGENT_READINESS_RULESET.name,
  version: AGENT_READINESS_RULESET.version,
  categoryWeights: {
    discovery: 15,
    documentation: 15,
    actionability: 10,
    machine_readable: 10,
    verification: 5,
    content_negotiation: 10,
    payments: 10,
    bazaar: 5,
    openapi: 10,
    skills: 5,
    agents_txt: 5,
    webmcp: 5,
    identity: 5,
    bot_auth: 5,
    infrastructure: 5,
  },
};

async function runScan(url: string) {
  const sourceState = await scanDomain(url, { noCache: true });
  const ruleEngineResult = RuleEngine.run(sourceState);
  const scoreResult = runScoringEngine({
    assertions: ruleEngineResult.assertions as any,
    rulesetManifest: SCORING_MANIFEST as any,
  });

  const assertions = ruleEngineResult.assertions as any[];
  const checks = assertions.map((a) => ({
    id: a.rule_id ?? a.id ?? "unknown",
    name: a.rule_name ?? a.name ?? a.rule_id ?? "unknown",
    status: a.status === "VERIFIED" || a.status === "INFERRED"
      ? "pass"
      : a.status === "NOT_APPLICABLE"
        ? "skip"
        : "fail",
    category: a.category,
  }));

  const score =
    typeof scoreResult.total === "number"
      ? scoreResult.total
      : (scoreResult.total as any).score ?? (scoreResult.total as any).rawScore ?? 0;

  return { checks, score, assertions };
}

describe("E2E: isitagentready.com score >= 80", () => {
  it(
    "all AB-061..AB-069 rules pass on " + TARGET_URL,
    async () => {
      const result = await runScan(TARGET_URL);

      const isitagentreadyRules = result.checks.filter(
        (c) => c.id >= "AB-061" && c.id <= "AB-069",
      );

      // Should have rules in the AB-061..AB-069 range
      expect(isitagentreadyRules.length).toBeGreaterThan(0);

      const failed = isitagentreadyRules.filter((r) => r.status !== "pass");
      if (failed.length > 0) {
        console.error(
          "Failed AB-061..AB-069 rules:",
          failed.map((r) => `${r.id}: ${r.name} (${r.status})`),
        );
      }

      for (const rule of isitagentreadyRules) {
        expect(rule.status).toBe("pass");
      }
    },
    120000,
  );

  it(
    "overall score is >= 80 on " + TARGET_URL,
    async () => {
      const result = await runScan(TARGET_URL);

      if (result.score < 80) {
        const failed = result.checks.filter((c) => c.status === "fail");
        console.error(
          `Score ${result.score} < 80. Failed checks:`,
          failed.map((c) => `${c.id}: ${c.name}`),
        );
      }

      expect(result.score).toBeGreaterThanOrEqual(80);
    },
    120000,
  );
});
