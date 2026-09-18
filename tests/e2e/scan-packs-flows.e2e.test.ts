import { describe, it, expect, beforeEach } from "vitest";
import { RuleEngine } from "../../src/agent-readiness/rule-engine/rule-engine";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";
import { formatScanReport } from "../../src/agent-readiness/report-formatter";
import { computeBundleScores } from "../../src/agent-readiness/scoring/bundle-scorer";
import {
  BUNDLE_IDS,
  resolveBundleIds,
  resourcesForBundles,
} from "../../src/agent-readiness/rule-bundles";
import { DEFAULT_RESOURCES } from "../../src/agent-readiness/scanner/orchestrator";
import { richApiSourceState } from "../fixtures/semantic/rich-api/source-state";
import type { AgentReadinessRule } from "../../src/agent-readiness/rule.schema";

const rules = AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[];

/**
 * SLICE-133-19: E2E pack scan flows — engine-level coverage on a rich
 * fixture sourceState (no live network). API-level flows are covered by
 * tests/total-scan-packs.test.ts + tests/total-scan-pricing.test.ts.
 */
describe("E2E: pack scan flows (SLICE-133-19)", () => {
  beforeEach(() => {
    RuleEngine.reset();
  });

  it("single pack → bundleScores only for that bundle", () => {
    const result = RuleEngine.run(richApiSourceState, { packs: ["discovery-crawling"] });
    expect(result.bundles).toEqual(["discovery-crawling"]);
    const scores = computeBundleScores(result.assertions, rules);
    expect(Object.keys(scores.scores)).toEqual(["discovery-crawling"]);
    // discovery-crawling bundle has ~23 rules in the vendored ruleset
    expect(result.totalRules).toBeGreaterThan(10);
    expect(result.totalRules).toBeLessThan(rules.length);
  });

  it("multi-pack → union of rules, both sub-scores, upsell lists remaining 8", () => {
    const result = RuleEngine.run(richApiSourceState, {
      packs: ["discovery-crawling", "payments-x402"],
    });
    expect(result.bundles).toEqual(["discovery-crawling", "payments-x402"]);
    const report = formatScanReport("https://fixture.test", result, {
      packs: ["discovery-crawling", "payments-x402"],
    });
    expect(report.bundles).toEqual(["discovery-crawling", "payments-x402"]);
    expect(report.bundleScores).toBeDefined();
    expect(report.upsell).toBeDefined();
    expect(report.upsell!.notChecked).toHaveLength(8);
    expect(report.upsell!.notChecked.map((b) => b.id)).not.toContain("discovery-crawling");
    expect(report.upsell!.notChecked.map((b) => b.id)).not.toContain("payments-x402");
  });

  it("full scan → all rules, no upsell block", () => {
    const result = RuleEngine.run(richApiSourceState);
    expect(result.bundles).toEqual([...BUNDLE_IDS]);
    expect(result.totalRules).toBe(rules.length);
    const report = formatScanReport("https://fixture.test", result);
    expect(report.upsell).toBeUndefined();
    expect(report.bundleScores).toBeUndefined();
  });

  it("invalid id → resolveBundleIds returns unknown", () => {
    const { ok, unknown } = resolveBundleIds(["bogus", "discovery-crawling"]);
    expect(unknown).toEqual(["bogus"]);
    expect(ok).toEqual(["discovery-crawling"]);
  });

  it("legacy alias 'safety' → resolves to auth-identity rules", () => {
    const { ok, unknown } = resolveBundleIds(["safety"]);
    expect(unknown).toEqual([]);
    expect(ok).toEqual(["auth-identity"]);
    const result = RuleEngine.run(richApiSourceState, { packs: ["safety"] });
    expect(result.bundles).toEqual(["auth-identity"]);
  });

  it("scoped fetch proof — pack scan fetches fewer resources than full", () => {
    const scoped = resourcesForBundles(["discovery-crawling"], rules);
    const full = [...DEFAULT_RESOURCES];
    expect(scoped.length).toBeLessThan(full.length);
    expect(scoped.length).toBeGreaterThan(0);
    // multi-pack union ⊆ full
    const multi = resourcesForBundles(["discovery-crawling", "payments-x402"], rules);
    expect(multi.length).toBeLessThanOrEqual(full.length);
    expect(multi.length).toBeGreaterThan(scoped.length - 1);
  });
});
