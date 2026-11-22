import type { ReviewType } from "./types";

/**
 * EPIC-230 (SLICE-230-3, D-230-6): platform criteria templates.
 *
 * Each reviewType carries a FIXED platform rubric — the operator
 * scores these, never the agent's free-text `agentCriteria` wishes
 * (shown for context only, kept out of the scoring structure so an
 * agent can't steer its own evaluation — §16.2).
 *
 * `required:true` means a FAIL on that criterion contradicts any
 * APPROVED* outcome — decide.ts enforces the cross-field check so a
 * reviewer can't rubber-stamp a failed must-have.
 */

export interface CriterionTemplate {
  key: string;
  label: string;
  required: boolean;
}

export const REVIEW_CRITERIA: Readonly<
  Record<ReviewType, readonly CriterionTemplate[]>
> = {
  API_SURFACE: [
    {
      key: "contract-accuracy",
      label: "Documented contract matches actual API behavior",
      required: true,
    },
    {
      key: "error-shapes",
      label: "Error codes and response shapes match the spec",
      required: true,
    },
    {
      key: "breaking-changes",
      label: "Breaking changes are flagged and described",
      required: true,
    },
    {
      key: "auth-and-limits",
      label: "Auth requirements and rate limits are documented",
      required: false,
    },
  ],
  DOCS: [
    {
      key: "accuracy",
      label: "Statements are factually correct against the system",
      required: true,
    },
    {
      key: "completeness",
      label: "Covers the steps an agent needs end-to-end",
      required: true,
    },
    {
      key: "examples-valid",
      label: "Examples run as written",
      required: false,
    },
    {
      key: "links-integrity",
      label: "Links resolve to the intended targets",
      required: false,
    },
  ],
  CODE_SNIPPET: [
    {
      key: "correctness",
      label: "Snippet compiles/runs and does what it claims",
      required: true,
    },
    {
      key: "security",
      label: "No injection, secret, or unsafe-handling issues",
      required: true,
    },
    {
      key: "idiomatic",
      label: "Follows the conventions of the surrounding codebase",
      required: false,
    },
  ],
  INTEGRATION: [
    {
      key: "e2e-flow",
      label: "The integrated flow works end-to-end as described",
      required: true,
    },
    {
      key: "auth-flow",
      label: "Identity/auth handoff is correct",
      required: true,
    },
    {
      key: "error-handling",
      label: "Failure modes are handled, not just the happy path",
      required: false,
    },
    {
      key: "edge-cases",
      label: "Timeouts, retries and boundary inputs are covered",
      required: false,
    },
  ],
  OTHER: [
    {
      key: "accuracy",
      label: "The submission is factually accurate",
      required: true,
    },
    {
      key: "completeness",
      label: "The submission is complete enough to evaluate",
      required: false,
    },
  ],
};

export function criteriaForReview(
  reviewType: string,
): readonly CriterionTemplate[] {
  return REVIEW_CRITERIA[reviewType as ReviewType] ?? REVIEW_CRITERIA.OTHER;
}
