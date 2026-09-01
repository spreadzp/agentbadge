import type { AgentReadinessRule } from "../rule.schema";
import type { Evidence } from "./evidence.types";
import type { AssertionStatus } from "./status-determinator";
import { normalizeStatus } from "../shared.schema";

export interface Assertion {
  rule_id: string;
  rule_version: string;
  status: AssertionStatus;
  evidence: Evidence[];
  confidence: number;
  timestamp: string;
  source_url: string | null;
  reason: string;
  category: string;
  name: string;
  fix?: { eligible: boolean; type: string; note?: string };
}

class AssertionBuilderClass {
  /**
   * Build a typed Assertion from rule, evidence, status, and confidence.
   * Evidence array is ordered by collection time (insertion order preserved).
   */
  build(input: {
    rule: AgentReadinessRule;
    evidence: Evidence[];
    status: AssertionStatus;
    confidence: number;
    reason: string;
    sourceUrl?: string | null;
  }): Assertion {
    return {
      rule_id: input.rule.rule_id,
      rule_version: input.rule.version,
      status: input.status,
      evidence: [...input.evidence],
      confidence: this.clampConfidence(input.confidence),
      timestamp: new Date().toISOString(),
      source_url: input.sourceUrl ?? null,
      reason: input.reason,
      category: input.rule.category,
      name: input.rule.name,
      fix: input.rule.fix,
    };
  }

  /**
   * Serialize assertion to JSON. Ensures no functions or circular refs.
   */
  serialize(assertion: Assertion): string {
    return JSON.stringify(assertion, null, 2);
  }

  /**
   * Deserialize JSON to Assertion.
   */
  deserialize(json: string): Assertion {
    const parsed = JSON.parse(json);
    return {
      rule_id: parsed.rule_id,
      rule_version: parsed.rule_version,
      status: normalizeStatus(parsed.status),
      evidence: parsed.evidence,
      confidence: parsed.confidence,
      timestamp: parsed.timestamp,
      source_url: parsed.source_url ?? null,
      reason: parsed.reason,
      category: parsed.category ?? "",
      name: parsed.name ?? "",
      fix: parsed.fix,
    };
  }

  private clampConfidence(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}

export const AssertionBuilder = new AssertionBuilderClass();
export { AssertionBuilderClass };
