/**
 * EPIC-232 (SLICE-232-6, spec E5): `feedback_extract` scenario —
 * structured extraction of suggestions/issues/topics out of
 * feedback texts (subject `feedback`) and review artifacts
 * (subject `review`).
 *
 * 230 soft-dep seam (AC#2): stores are injected; a missing store for
 * the job's subject degrades to `{notAvailable}` → audited
 * `seam_unavailable` skip, zero provider calls.
 *
 * D-230 convention: extraction ≠ entry — the runner only produces
 * AiRun.output; nothing here materializes Feedback/Knowledge
 * records. The review center renders items as advisory suggestions;
 * a human decides what becomes a typed record.
 */

import type { FeedbackStore } from "../feedback/store";
import type { ReviewStore } from "../reviews/store";

import { promptFor } from "./intake-runners";
import { registerScenarioRunner } from "./scenarios";
import type { AiScenarioRunner } from "./scenarios";

export const FEEDBACK_EXTRACT_SCENARIO = "feedback_extract";

export const FEEDBACK_ITEM_TYPES = [
  "suggestion",
  "issue",
  "topic",
] as const;
export const FEEDBACK_SENTIMENTS = [
  "positive",
  "negative",
  "neutral",
  "mixed",
] as const;

const FEEDBACK_EXTRACT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...FEEDBACK_ITEM_TYPES] },
          text: { type: "string" },
          sentiment: { type: "string", enum: [...FEEDBACK_SENTIMENTS] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["type", "text", "sentiment", "confidence"],
        additionalProperties: false,
      },
    },
    overallConfidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["items", "overallConfidence"],
  additionalProperties: false,
};

const FALLBACK_FEEDBACK_EXTRACT =
  "Extract structured items from the text: {items[{type ∈ " +
  "suggestion|issue|topic, text, sentiment ∈ " +
  "positive|negative|neutral|mixed, confidence 0..1}], " +
  "overallConfidence 0..1}. JSON only.";

const FEEDBACK_RUNNER_SUBJECTS = ["feedback", "review_case"] as const;

async function feedbackText(
  store: FeedbackStore,
  subjectId: string,
): Promise<string> {
  const rec = await store.getFeedback(subjectId);
  if (!rec) throw new Error(`subject_not_found: ${subjectId}`);
  const meta = [
    rec.kind ? `kind: ${rec.kind}` : "",
    rec.target ? `target: ${rec.target}` : "",
    rec.severity ? `severity hint: ${rec.severity}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta ? meta + "\n" : ""}text:\n${rec.text}`;
}

async function reviewText(
  store: ReviewStore,
  subjectId: string,
): Promise<string> {
  const rec = await store.getReview(subjectId);
  if (!rec) throw new Error(`subject_not_found: ${subjectId}`);
  const evidence = await store.listEvidence(subjectId);
  const ev = evidence
    .map(
      (e) =>
        `- [${e.type}] ${e.uri}` +
        (e.label ? ` (${e.label})` : "") +
        (e.description ? ` — ${e.description}` : ""),
    )
    .join("\n");
  const criteria = rec.agentCriteria
    ? `agentCriteria: ${JSON.stringify(rec.agentCriteria)}\n`
    : "";
  return (
    `reviewType: ${rec.reviewType}\nworkRef: ${rec.workRef}\n${criteria}` +
    `evidence:\n${ev || "(none)"}`
  );
}

/** Bind the 230 stores into the feedback_extract runner. */
export function registerFeedbackExtractRunner(opts: {
  /** null → feedback subjects degrade to NOT_AVAILABLE. */
  feedback: FeedbackStore | null;
  /** null → review subjects degrade to NOT_AVAILABLE. */
  reviews: ReviewStore | null;
}): void {
  const { feedback, reviews } = opts;

  const runner: AiScenarioRunner = async ({ job }) => {
    let user: string;
    if (job.subjectType === "feedback") {
      if (!feedback) return { notAvailable: "feedback_store" };
      user = `feedback record:\n${await feedbackText(feedback, job.subjectId)}`;
    } else if (job.subjectType === "review_case") {
      if (!reviews) return { notAvailable: "review_store" };
      user = `review case:\n${await reviewText(reviews, job.subjectId)}`;
    } else {
      throw new Error(
        `unsupported_subject: ${FEEDBACK_EXTRACT_SCENARIO} takes ` +
          `${FEEDBACK_RUNNER_SUBJECTS.join("|")}, got ${job.subjectType}`,
      );
    }
    return promptFor(
      FEEDBACK_EXTRACT_SCENARIO,
      FALLBACK_FEEDBACK_EXTRACT,
      user,
      FEEDBACK_EXTRACT_SCHEMA,
      500,
    );
  };

  registerScenarioRunner(FEEDBACK_EXTRACT_SCENARIO, runner);
}
