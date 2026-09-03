import { describe, it, expect } from "vitest";
import { prioritizeGaps } from "../../../src/agent-readiness/gap-engine/gap-priority";
import type { Gap } from "../../../src/agent-readiness/gap-engine/gap-types";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import { CATEGORY_TO_PILLAR } from "../../../src/agent-readiness/scoring/pillar-map";

/**
 * SLICE-96-4: Prioritization Model — severity × impact × frequency
 *
 * Golden vectors hand-computed from spec v0.5 §8.2 pseudocode and
 * DEFAULT_CATEGORY_WEIGHTS + CATEGORY_TO_PILLAR.
 *
 * Priority levels: CRITICAL=4, HIGH=3, MEDIUM=2, LOW=1
 * Impact = category_weight / sum_of_weights_in_pillar
 *   top quartile within pillar → +1 level
 *   bottom quartile within pillar → −1 level
 * Frequency = distinct contributing rules ≥ 3 → +1 level
 * Critical floor: any contributing rule severity=critical → CRITICAL (never lowered)
 * Clamp LOW..CRITICAL; order: impact then frequency
 */

function makeGap(overrides: Partial<Gap> & { category: string; type: Gap["type"] }): Gap {
  return {
    gap_id: `gap:${overrides.type}:${overrides.category}`,
    title: "Test gap",
    description: "Test description",
    priority: "LOW",
    priority_reason: "",
    related_rules: ["AB-001"],
    evidence_refs: [],
    fix_hint: "deterministic",
    fix_artifacts: [],
    pillar: CATEGORY_TO_PILLAR[overrides.category as keyof typeof CATEGORY_TO_PILLAR],
    frequency: 1,
    ...overrides,
  };
}

// Severity metadata per rule — simulates what prioritizeGaps needs
interface RuleSeverity {
  rule_id: string;
  severity: "critical" | "high" | "medium" | "low";
}

describe("SLICE-96-4: Prioritization Model", () => {
  describe("golden vectors — base severity mapping", () => {
    it("low severity → LOW base, no adjustments → LOW", () => {
      // Use content_negotiation (middle quartile in discovery pillar) to avoid impact adjustment
      const gap = makeGap({ category: "content_negotiation", type: "documentation", related_rules: ["AB-001"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-001", severity: "low" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("LOW");
      expect(result[0].priority_reason).toContain("severity=low");
    });

    it("medium severity → MEDIUM base, no adjustments → MEDIUM", () => {
      // Use agent_policy (weight=2, middle quartile in verifiability pillar)
      const gap = makeGap({ category: "agent_policy", type: "semantic", related_rules: ["AB-002"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-002", severity: "medium" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("MEDIUM");
    });

    it("high severity → HIGH base, no adjustments → HIGH", () => {
      // Use verification (middle quartile in verifiability pillar) to avoid impact adjustment
      // Verifiability: verification=5, active_probing=5, agent_policy=2, infrastructure=1 → n=4
      // q1Count=ceil(4*0.25)=1 → top={verification}, bottom={infrastructure}
      // Actually verification is in top quartile! Use active_probing instead.
      // active_probing=5, sorted: [5,5,2,1], top 1 = {verification or active_probing}
      // Hmm, both have weight 5. Let's use agent_policy (weight=2, middle).
      const gap = makeGap({ category: "agent_policy", type: "semantic", related_rules: ["AB-003"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-003", severity: "high" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("HIGH");
    });

    it("critical severity → CRITICAL base, critical floor → CRITICAL", () => {
      const gap = makeGap({ category: "bot_auth", type: "capability", related_rules: ["AB-004"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-004", severity: "critical" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("CRITICAL");
      expect(result[0].priority_reason).toContain("floor");
    });
  });

  describe("golden vectors — impact quartiles", () => {
    // Discovery pillar: discovery=15, machine_readable=10, openapi=10, content_negotiation=5,
    //   seo_aeo=5, skills=5, agents_txt=3, webmcp=3 → total=56, n=8
    //   Shares: discovery=0.268, machine_readable=0.179, openapi=0.179,
    //     content_negotiation=0.089, seo_aeo=0.089, skills=0.089, agents_txt=0.054, webmcp=0.054
    //   Sorted desc: 0.268, 0.179, 0.179, 0.089, 0.089, 0.089, 0.054, 0.054
    //   Top quartile (Q3 = 75th percentile, nearest-rank at ceil(8*0.75)=6): top 2 values
    //   Bottom quartile (Q1 = 25th percentile, nearest-rank at ceil(8*0.25)=2): bottom 2 values

    it("top quartile impact → +1 level (discovery category in discovery pillar)", () => {
      // discovery weight=15, pillar total=56, share=0.268 → top quartile → +1
      // base=medium → MEDIUM +1 = HIGH
      const gap = makeGap({ category: "discovery", type: "documentation", related_rules: ["AB-010"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-010", severity: "medium" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("HIGH");
      expect(result[0].priority_reason).toContain("top quartile");
      expect(result[0].priority_reason).toContain("+1");
    });

    it("bottom quartile impact → -1 level (webmcp category in discovery pillar)", () => {
      // webmcp weight=3, pillar total=56, share=0.054 → bottom quartile → -1
      // base=medium → MEDIUM -1 = LOW
      const gap = makeGap({ category: "webmcp", type: "documentation", related_rules: ["AB-011"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-011", severity: "medium" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("LOW");
      expect(result[0].priority_reason).toContain("bottom quartile");
      expect(result[0].priority_reason).toContain("-1");
    });

    it("middle quartile impact → no adjustment (content_negotiation in discovery pillar)", () => {
      // content_negotiation weight=5, share=0.089 → middle → no adjustment
      // base=medium → MEDIUM
      const gap = makeGap({ category: "content_negotiation", type: "documentation", related_rules: ["AB-012"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-012", severity: "medium" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("MEDIUM");
      expect(result[0].priority_reason).toContain("no adjustment");
    });
  });

  describe("golden vectors — frequency bump", () => {
    it("frequency ≥ 3 → +1 level", () => {
      // base=medium → MEDIUM, no impact adjustment (middle), freq=3 → +1 → HIGH
      const gap = makeGap({
        category: "content_negotiation",
        type: "documentation",
        related_rules: ["AB-020", "AB-021", "AB-022"],
        frequency: 3,
      });
      const rules: RuleSeverity[] = [
        { rule_id: "AB-020", severity: "medium" },
        { rule_id: "AB-021", severity: "medium" },
        { rule_id: "AB-022", severity: "medium" },
      ];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("HIGH");
      expect(result[0].priority_reason).toContain("frequency=3");
      expect(result[0].priority_reason).toContain("+1");
    });

    it("frequency = 2 → no bump", () => {
      const gap = makeGap({
        category: "content_negotiation",
        type: "documentation",
        related_rules: ["AB-023", "AB-024"],
        frequency: 2,
      });
      const rules: RuleSeverity[] = [
        { rule_id: "AB-023", severity: "medium" },
        { rule_id: "AB-024", severity: "medium" },
      ];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("MEDIUM");
      expect(result[0].priority_reason).toContain("frequency=2");
    });
  });

  describe("golden vectors — critical floor", () => {
    it("critical floor prevents lowering (bottom quartile + critical → still CRITICAL)", () => {
      // bot_auth weight=1, executability total=26, share=0.038 → bottom quartile → -1
      // base=critical → CRITICAL, -1 would be HIGH, but floor → CRITICAL
      const gap = makeGap({ category: "bot_auth", type: "capability", related_rules: ["AB-030"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-030", severity: "critical" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("CRITICAL");
      expect(result[0].priority_reason).toContain("floor");
    });

    it("critical floor with multiple rules, one critical → CRITICAL", () => {
      const gap = makeGap({
        category: "bot_auth",
        type: "capability",
        related_rules: ["AB-031", "AB-032", "AB-033"],
        frequency: 3,
      });
      const rules: RuleSeverity[] = [
        { rule_id: "AB-031", severity: "critical" },
        { rule_id: "AB-032", severity: "medium" },
        { rule_id: "AB-033", severity: "low" },
      ];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("CRITICAL");
    });
  });

  describe("golden vectors — clamping", () => {
    it("clamp at LOW (low base, bottom quartile → can't go below LOW)", () => {
      // webmcp weight=3, share=0.054 → bottom quartile → -1
      // base=low → LOW -1 = would be 0, clamp → LOW
      const gap = makeGap({ category: "webmcp", type: "documentation", related_rules: ["AB-040"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-040", severity: "low" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("LOW");
      expect(result[0].priority_reason).toContain("clamp");
    });

    it("clamp at CRITICAL (high base + top quartile + freq bump → can't go above CRITICAL)", () => {
      // discovery weight=15, share=0.268 → top quartile → +1
      // base=high → HIGH +1 = CRITICAL, freq=3 → +1 → would exceed, clamp → CRITICAL
      const gap = makeGap({
        category: "discovery",
        type: "documentation",
        related_rules: ["AB-041", "AB-042", "AB-043"],
        frequency: 3,
      });
      const rules: RuleSeverity[] = [
        { rule_id: "AB-041", severity: "high" },
        { rule_id: "AB-042", severity: "high" },
        { rule_id: "AB-043", severity: "high" },
      ];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("CRITICAL");
    });
  });

  describe("golden vectors — zero adjustment identity", () => {
    it("medium base, middle quartile, freq=1 → MEDIUM (no adjustments)", () => {
      const gap = makeGap({ category: "content_negotiation", type: "documentation", related_rules: ["AB-050"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-050", severity: "medium" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority).toBe("MEDIUM");
      expect(result[0].priority_reason).toContain("no adjustment");
      expect(result[0].priority_reason).toContain("frequency=1");
    });
  });

  describe("spec §8.2 worked example", () => {
    it("documentation category, 3 contributing rules (high+medium+medium) → HIGH", () => {
      // From spec v0.5 §8.2 worked example:
      // Gap: gap:semantic:documentation (but we'll use gap:documentation:documentation for type)
      // Actually the spec example uses gap:semantic:documentation — but documentation category
      // has default gap_type "documentation", not "semantic". The spec example may have a typo.
      // Let's test with the actual math:
      // documentation weight=15, understandability pillar total=35, share=0.429 → top quartile → +1
      // base=high (max severity) → HIGH +1 = CRITICAL
      // freq=3 → +1 → would exceed → clamp CRITICAL
      // Actually the spec says bottom quartile for 0.20... let me re-check.
      // The spec example says "documentation=5, pillar understandability total=25 → share=0.20"
      // But actual weights: documentation=15, understandability total=35 → share=0.429
      // The spec example uses different weights than the actual manifest.
      // We test against actual manifest weights, not the spec's hypothetical numbers.
      const gap = makeGap({
        category: "documentation",
        type: "documentation",
        related_rules: ["AB-146", "AB-147", "AB-148"],
        frequency: 3,
      });
      const rules: RuleSeverity[] = [
        { rule_id: "AB-146", severity: "high" },
        { rule_id: "AB-147", severity: "medium" },
        { rule_id: "AB-148", severity: "medium" },
      ];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      // documentation share=15/35=0.429 → top quartile → +1
      // base=high → HIGH +1 = CRITICAL
      // freq=3 → +1 → clamp CRITICAL
      expect(result[0].priority).toBe("CRITICAL");
      expect(result[0].priority_reason).toContain("severity=high");
      expect(result[0].priority_reason).toContain("top quartile");
      expect(result[0].priority_reason).toContain("frequency=3");
    });
  });

  describe("sorting contract", () => {
    it("gaps sorted by priority desc, then category asc", () => {
      const gaps: Gap[] = [
        makeGap({ category: "webmcp", type: "documentation", related_rules: ["AB-060"] }),
        makeGap({ category: "discovery", type: "documentation", related_rules: ["AB-061"] }),
        makeGap({ category: "bot_auth", type: "capability", related_rules: ["AB-062"] }),
      ];
      const rules: RuleSeverity[] = [
        { rule_id: "AB-060", severity: "low" },     // LOW
        { rule_id: "AB-061", severity: "high" },    // HIGH (top quartile +1 → CRITICAL, clamp)
        { rule_id: "AB-062", severity: "critical" }, // CRITICAL (floor)
      ];
      const result = prioritizeGaps(gaps, DEFAULT_CATEGORY_WEIGHTS, rules);
      // CRITICAL (bot_auth) > CRITICAL (discovery, clamped) → but both CRITICAL, sort by category
      // bot_auth < discovery alphabetically → bot_auth first
      expect(result[0].category).toBe("bot_auth");
      expect(result[0].priority).toBe("CRITICAL");
      expect(result[result.length - 1].priority).toBe("LOW");
    });
  });

  describe("manifest integrity", () => {
    it("pricing impact = 3/35 in understandability pillar", () => {
      // pricing weight=3, understandability total = 15+10+4+3+3 = 35
      // share = 3/35 = 0.0857
      const gap = makeGap({ category: "pricing", type: "semantic", related_rules: ["AB-150"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-150", severity: "high" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority_reason).toContain("0.086");
    });

    it("bot_auth impact = 1/26 in executability pillar", () => {
      // bot_auth weight=1, executability total = 1+2+10+5+3+2+1+2 = 26
      // share = 1/26 = 0.038
      const gap = makeGap({ category: "bot_auth", type: "capability", related_rules: ["AB-153"] });
      const rules: RuleSeverity[] = [{ rule_id: "AB-153", severity: "critical" }];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      expect(result[0].priority_reason).toContain("0.038");
    });
  });

  describe("priority_reason format", () => {
    it("contains key=value segments for all inputs", () => {
      const gap = makeGap({
        category: "discovery",
        type: "documentation",
        related_rules: ["AB-070", "AB-071", "AB-072"],
        frequency: 3,
      });
      const rules: RuleSeverity[] = [
        { rule_id: "AB-070", severity: "high" },
        { rule_id: "AB-071", severity: "medium" },
        { rule_id: "AB-072", severity: "medium" },
      ];
      const result = prioritizeGaps([gap], DEFAULT_CATEGORY_WEIGHTS, rules);
      const reason = result[0].priority_reason;
      expect(reason).toContain("severity=");
      expect(reason).toContain("impact");
      expect(reason).toContain("frequency=");
      expect(reason).toContain("final");
    });
  });

  describe("empty input", () => {
    it("empty gaps → empty result", () => {
      const result = prioritizeGaps([], DEFAULT_CATEGORY_WEIGHTS, []);
      expect(result).toEqual([]);
    });
  });
});
