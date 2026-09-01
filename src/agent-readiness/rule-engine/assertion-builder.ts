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
  claim: string;
  verified_at: string;
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
    claim?: string;
  }): Assertion {
    const timestamp = new Date().toISOString();
    const claim = input.claim ?? input.rule.name;
    const verifiedAt = this.computeVerifiedAt(input.evidence, timestamp);
    return {
      rule_id: input.rule.rule_id,
      rule_version: input.rule.version,
      status: input.status,
      evidence: [...input.evidence],
      confidence: this.clampConfidence(input.confidence),
      timestamp,
      source_url: input.sourceUrl ?? null,
      reason: input.reason,
      category: input.rule.category,
      name: input.rule.name,
      claim,
      verified_at: verifiedAt,
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
    const timestamp = parsed.timestamp ?? new Date().toISOString();
    return {
      rule_id: parsed.rule_id,
      rule_version: parsed.rule_version,
      status: normalizeStatus(parsed.status),
      evidence: parsed.evidence ?? [],
      confidence: parsed.confidence,
      timestamp,
      source_url: parsed.source_url ?? null,
      reason: parsed.reason,
      category: parsed.category ?? "",
      name: parsed.name ?? "",
      claim: parsed.claim ?? parsed.name ?? "",
      verified_at: parsed.verified_at ?? timestamp,
      fix: parsed.fix,
    };
  }

  private clampConfidence(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private computeVerifiedAt(evidence: Evidence[], fallback: string): string {
    const timestamps = evidence
      .map((e) => e.captured_at)
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    if (timestamps.length === 0) return fallback;
    return timestamps.reduce((max, t) => (t > max ? t : max), timestamps[0]);
  }
}

export const AssertionBuilder = new AssertionBuilderClass();
export { AssertionBuilderClass };
