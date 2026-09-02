import type { AssertionStatus } from "./status-determinator";

export const REVIEW_CONFIDENCE_THRESHOLD = 0.80;

export type ReviewLevel = "automatic" | "assisted" | null;

export function computeReviewLevel(input: {
  confidence: number | null;
  status: AssertionStatus;
}): ReviewLevel {
  if (input.status === "NOT_APPLICABLE" || input.confidence === null) {
    return null;
  }
  return input.confidence >= REVIEW_CONFIDENCE_THRESHOLD ? "automatic" : "assisted";
}
