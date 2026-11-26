/**
 * EPIC-232 (SLICE-232-7, spec E6 + D-232-4): `review_assist` —
 * an advisory checklist recommendation over a `review_case`.
 *
 * The prompt carries the platform criteria TEMPLATE for the case's
 * reviewType (same `criteriaForReview` the human decides against —
 * comparability) plus the case fields and evidence rows. Output:
 *   {criteria[{name,passed,evidence,confidence}], recommendation,
 *    confidence}.
 *
 * §16.5 boundary: the run is an advisory artifact only — a
 * ReviewDecision is human-written exclusively; the nullable
 * `aiRunRef` on the decision records which run the HUMAN referenced
 * via the decide form, never an AI write.
 *
 * 230 seam: `reviews: null` → `notAvailable` skip (232-4 contract).
 */

import { criteriaForReview } from "../reviews/criteria";
import type { ReviewStore } from "../reviews/store";

import { promptFor } from "./intake-runners";
import { registerScenarioRunner } from "./scenarios";
import type { AiScenarioRunner } from "./scenarios";

export const REVIEW_ASSIST_SCENARIO = "review_assist";
export const REVIEW_ASSIST_SUBJECT = "review_case";

const REVIEW_ASSIST_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    criteria: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          /** criterion key FROM THE TEMPLATE — verbatim. */
          name: { type: "string" },
          passed: { type: "boolean" },
          /** evidence uri/label this verdict leans on (optional). */
          evidence: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "passed", "confidence"],
        additionalProperties: false,
      },
    },
    recommendation: {
      type: "string",
      enum: ["APPROVE", "APPROVE_WITH_NOTES", "CHANGES_REQUESTED", "REJECT"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["criteria", "recommendation", "confidence"],
  additionalProperties: false,
};

const FALLBACK_REVIEW_ASSIST =
  "You are an advisory review assistant. Score the case against the " +
  "platform criteria template given: {criteria[{name (template key), " +
  "passed, evidence?, confidence 0..1}], recommendation ∈ " +
  "APPROVE|APPROVE_WITH_NOTES|CHANGES_REQUESTED|REJECT, confidence " +
  "0..1}. Advisory only — a human decides. JSON only.";

/** Bind the reviews store into the review_assist runner. */
export function registerReviewAssistRunner(opts: {
  /** null → review_case subjects degrade to NOT_AVAILABLE. */
  reviews: ReviewStore | null;
}): void {
  const { reviews } = opts;

  const runner: AiScenarioRunner = async ({ job }) => {
    if (job.subjectType !== REVIEW_ASSIST_SUBJECT) {
      throw new Error(
        `unsupported_subject: ${REVIEW_ASSIST_SCENARIO} takes ` +
          `${REVIEW_ASSIST_SUBJECT}, got ${job.subjectType}`,
      );
    }
    if (!reviews) return { notAvailable: "review_store" };

    const rec = await reviews.getReview(job.subjectId);
    if (!rec) throw new Error(`subject_not_found: ${job.subjectId}`);
    const [evidence, template] = await Promise.all([
      reviews.listEvidence(job.subjectId),
      Promise.resolve(criteriaForReview(rec.reviewType)),
    ]);
    const ev = evidence
      .map(
        (e) =>
          `- [${e.type}] ${e.uri}` +
          (e.label ? ` (${e.label})` : "") +
          (e.description ? ` — ${e.description}` : ""),
      )
      .join("\n");
    const tpl = template
      .map((c) => `- ${c.key}: ${c.label}${c.required ? " (required)" : ""}`)
      .join("\n");
    const user =
      `reviewType: ${rec.reviewType}\nworkRef: ${rec.workRef}\n` +
      (rec.agentCriteria
        ? `agentCriteria: ${JSON.stringify(rec.agentCriteria)}\n`
        : "") +
      `platform criteria template:\n${tpl}\n\nevidence:\n${ev || "(none)"}`;
    return promptFor(
      REVIEW_ASSIST_SCENARIO,
      FALLBACK_REVIEW_ASSIST,
      user,
      REVIEW_ASSIST_SCHEMA,
      600,
    );
  };

  registerScenarioRunner(REVIEW_ASSIST_SCENARIO, runner);
}
