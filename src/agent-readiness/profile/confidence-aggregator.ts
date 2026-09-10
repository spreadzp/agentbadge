import type { Assertion } from "../rule-engine/assertion-builder";

/**
 * SLICE-101-6: Confidence Aggregator.
 *
 * Pure function: computes confidence range (min, max, mean) for assertions.
 * Only VERIFIED and INFERRED assertions contribute (GAP/CONFLICT have zero confidence).
 */

export interface ConfidenceRange {
  min: number;
  max: number;
  mean: number;
}

export function aggregateConfidence(assertions: Assertion[]): ConfidenceRange {
  const confidences = assertions
    .filter((a) => a.status === "VERIFIED" || a.status === "INFERRED")
    .map((a) => a.confidence)
    .filter((c) => c > 0);

  if (confidences.length === 0) {
    return { min: 0, max: 0, mean: 0 };
  }

  return {
    min: Math.min(...confidences),
    max: Math.max(...confidences),
    mean: confidences.reduce((s, c) => s + c, 0) / confidences.length,
  };
}
