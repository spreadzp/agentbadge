import { describe, it, expect } from "vitest";
import { RuleEngine } from "../../src/agent-readiness/rule-engine/rule-engine";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../src/agent-readiness/scoring/scoring-types";
import { deriveGaps, summarizeGaps } from "../../src/agent-readiness/gap-engine/gap-engine";
import { prioritizeGaps } from "../../src/agent-readiness/gap-engine/gap-priority";
import { annotateFixReadiness } from "../../src/agent-readiness/gap-engine/gap-fix-hints";
import type { AgentReadinessRule } from "../../src/agent-readiness/rule.schema";
import type { Gap } from "../../src/agent-readiness/gap-engine/gap-types";
import { richApiSourceState } from "../fixtures/semantic/rich-api/source-state";
import { richApiSourceStateWithErrorSchemas } from "../fixtures/semantic/rich-api/source-state-with-error-schemas";

/**
 * SLICE-96-8: Rescan Stability E2E
 *
 * 1. Run the gap pipeline TWICE on the same fixture → identical gap sets
 *    (ids, priorities, order). Proves determinism.
 *
 * 2. Mutate the fixture (add 4xx/5xx error responses to OpenAPI spec) →
 *    rescan → AB-149 resolves (GAP→VERIFIED), gap:semantic:error_semantics
 *    disappears, others keep their ids.
 *    This is the EPIC-97 rescan-diff contract proven.
 */

function runGapPipeline(sourceState: typeof richApiSourceState): Gap[] {
  RuleEngine.reset();
  const result = RuleEngine.run(sourceState);
  const rawGaps = deriveGaps(result.assertions, AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[]);
  const ruleSeverities = AGENT_READINESS_RULESET.rules.map((r) => ({
    rule_id: r.rule_id,
    severity: r.severity as "critical" | "high" | "medium" | "low",
  }));
  const prioritized = prioritizeGaps(rawGaps, DEFAULT_CATEGORY_WEIGHTS, ruleSeverities);
  return annotateFixReadiness(prioritized, AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[]);
}

function gapSignature(gaps: Gap[]): string[] {
  return gaps.map((g) => `${g.gap_id}|${g.priority}|${g.type}|${g.frequency}`);
}

describe("SLICE-96-8: Rescan stability — gap_ids survive rescan", () => {
  it("two runs on same fixture produce identical gap sets", () => {
    const run1 = runGapPipeline(richApiSourceState);
    const run2 = runGapPipeline(richApiSourceState);

    expect(gapSignature(run1)).toEqual(gapSignature(run2));
  });

  it("two runs produce identical summaries", () => {
    const run1 = runGapPipeline(richApiSourceState);
    const run2 = runGapPipeline(richApiSourceState);

    expect(summarizeGaps(run1)).toEqual(summarizeGaps(run2));
  });

  it("mutated fixture (error schemas added) changes gap set", () => {
    const baseline = runGapPipeline(richApiSourceState);
    const mutated = runGapPipeline(richApiSourceStateWithErrorSchemas);

    // The gap sets should differ
    expect(gapSignature(baseline)).not.toEqual(gapSignature(mutated));
  });

  it("mutated fixture: at least one gap disappears", () => {
    const baseline = runGapPipeline(richApiSourceState);
    const mutated = runGapPipeline(richApiSourceStateWithErrorSchemas);

    const baselineIds = new Set(baseline.map((g) => g.gap_id));
    const mutatedIds = new Set(mutated.map((g) => g.gap_id));

    const disappeared = [...baselineIds].filter((id) => !mutatedIds.has(id));
    expect(disappeared.length).toBeGreaterThanOrEqual(1);
  });

  it("mutated fixture: surviving gaps keep their ids and priorities", () => {
    const baseline = runGapPipeline(richApiSourceState);
    const mutated = runGapPipeline(richApiSourceStateWithErrorSchemas);

    const baselineMap = new Map(baseline.map((g) => [g.gap_id, g]));
    const mutatedMap = new Map(mutated.map((g) => [g.gap_id, g]));

    // For every gap that exists in both, priority and type must be unchanged
    for (const [id, baselineGap] of baselineMap) {
      const mutatedGap = mutatedMap.get(id);
      if (mutatedGap) {
        expect(mutatedGap.priority).toBe(baselineGap.priority);
        expect(mutatedGap.type).toBe(baselineGap.type);
      }
    }
  });

  it("mutated fixture: gap:semantic:error_semantics specifically disappears", () => {
    const baseline = runGapPipeline(richApiSourceState);
    const mutated = runGapPipeline(richApiSourceStateWithErrorSchemas);

    const baselineIds = new Set(baseline.map((g) => g.gap_id));
    const mutatedIds = new Set(mutated.map((g) => g.gap_id));

    expect(baselineIds.has("gap:semantic:error_semantics")).toBe(true);
    expect(mutatedIds.has("gap:semantic:error_semantics")).toBe(false);
  });

  it("mutated fixture: no new gaps appear (only disappearance)", () => {
    const baseline = runGapPipeline(richApiSourceState);
    const mutated = runGapPipeline(richApiSourceStateWithErrorSchemas);

    const baselineIds = new Set(baseline.map((g) => g.gap_id));
    const mutatedIds = new Set(mutated.map((g) => g.gap_id));

    const newGaps = [...mutatedIds].filter((id) => !baselineIds.has(id));
    // Adding error schemas should not create new gaps — only resolve existing ones
    expect(newGaps).toEqual([]);
  });
});
