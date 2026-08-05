import type { AgentReadinessRule } from "../rule.schema";
import type { Evidence } from "./evidence.types";
import type { AssertionStatus } from "./status-determinator";

class ConfidenceComputerClass {
  /**
   * Compute confidence value (0.0–1.0) for an assertion.
   * Returns null for NOT_APPLICABLE.
   * Confidence is metadata only — never used in score calculations.
   */
  compute(input: {
    rule: AgentReadinessRule;
    evidence: Evidence[];
    status: AssertionStatus;
  }): number | null {
    switch (input.status) {
      case "NOT_APPLICABLE":
        return null;

      case "MISSING":
        return 0.0;

      case "CONFLICT":
        return this.computeConflictConfidence(input.evidence);

      case "INFERRED":
        return this.computeInferredConfidence(input.evidence);

      case "VERIFIED":
        return this.computeVerifiedConfidence(input.evidence);

      default:
        return 0.0;
    }
  }

  /**
   * VERIFIED with direct evidence:
   * 1 source → 0.9, 2+ sources → 0.95, 3+ → 1.0
   */
  private computeVerifiedConfidence(evidence: Evidence[]): number {
    const count = evidence.length;
    if (count >= 3) return 1.0;
    if (count >= 2) return 0.95;
    return 0.9;
  }

  /**
   * INFERRED: indirect evidence only.
   * 1 source → 0.5, 2 → 0.6, 3+ → 0.7
   */
  private computeInferredConfidence(evidence: Evidence[]): number {
    const count = evidence.length;
    if (count >= 3) return 0.7;
    if (count >= 2) return 0.6;
    return 0.5;
  }

  /**
   * CONFLICT: split confidence when sources disagree.
   * 2 sources → 0.0, 3+ sources with majority → 0.3
   */
  private computeConflictConfidence(evidence: Evidence[]): number {
    const crossCount = evidence.filter((e) => e.type === "cross").length;
    if (crossCount > 0 && evidence.length >= 3) return 0.3;
    return 0.0;
  }
}

export const ConfidenceComputer = new ConfidenceComputerClass();
export { ConfidenceComputerClass };
