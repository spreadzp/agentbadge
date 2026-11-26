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

import {
  promptFor,
  sanitizeInline,
  sanitizeUntrusted,
  UNTRUSTED_RULE,
  untrustedBlock,
} from "./intake-runners";
import { registerScenarioRunner } from "./scenarios";
import type { AiScenarioRunner } from "./scenarios";

export const REVIEW_ASSIST_SCENARIO = "review_assist";
export const REVIEW_ASSIST_SUBJECT = "review_case";

/** AI vocabulary — the comparator maps it onto human outcomes. */
export const REVIEW_ASSIST_RECOMMENDATIONS = [
  "APPROVE",
  "APPROVE_WITH_NOTES",
  "CHANGES_REQUESTED",
  "REJECT",
] as const;

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
          /** evidence uri/label this verdict leans on (nullable —
           *  strict-mode providers require every property). */
          evidence: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "passed", "evidence", "confidence"],
        additionalProperties: false,
      },
    },
    recommendation: {
      type: "string",
      enum: [...REVIEW_ASSIST_RECOMMENDATIONS],
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
  "0..1}. Advisory only — a human decides. JSON only. " +
  UNTRUSTED_RULE;

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
    // H-6: agent-controlled fields (evidence label/description,
    // agentCriteria) are injection surface — sanitize + fence.
    const ev = evidence
      .map(
        (e) =>
          `- [${sanitizeInline(e.type, 40)}] ${sanitizeInline(e.uri, 500)}` +
          (e.label ? ` (${sanitizeInline(e.label, 120)})` : "") +
          (e.description ? ` — ${sanitizeInline(e.description, 400)}` : ""),
      )
      .join("\n");
    const tpl = template
      .map((c) => `- ${c.key}: ${c.label}${c.required ? " (required)" : ""}`)
      .join("\n");
    // Delta-2 H-6: reviewType/workRef are agent-controlled fields —
    // they ride inside the evidence fence, not on instruction lines.
    const caseFields =
      `reviewType: ${sanitizeInline(rec.reviewType, 64)}\n` +
      `workRef: ${sanitizeInline(rec.workRef, 200)}\n\n`;
    const user =
      `case data:\n${untrustedBlock(caseFields + (ev || "(evidence: none)"))}\n` +
      (rec.agentCriteria
        ? `agentCriteria:\n${untrustedBlock(
            sanitizeUntrusted(JSON.stringify(rec.agentCriteria), 2000),
          )}\n`
        : "") +
      `platform criteria template:\n${tpl}`;
    const prompt = promptFor(
      REVIEW_ASSIST_SCENARIO,
      FALLBACK_REVIEW_ASSIST,
      user,
      REVIEW_ASSIST_SCHEMA,
      600,
    );
    // H-4: criterion names must be template keys, each at most once —
    // the model cannot invent criteria or duplicate a verdict.
    const templateKeys = new Set(template.map((c) => c.key));
    prompt.validateOutput = (output) => {
      const seen = new Set<string>();
      const criteria = (output as { criteria?: unknown })?.criteria;
      for (const c of Array.isArray(criteria) ? criteria : []) {
        const name = (c as { name?: unknown })?.name;
        if (typeof name !== "string" || !templateKeys.has(name)) {
          return `unknown_criterion: ${String(name).slice(0, 120)}`;
        }
        if (seen.has(name)) return `duplicate_criterion: ${name}`;
        seen.add(name);
      }
      return null;
    };
    return prompt;
  };

  registerScenarioRunner(REVIEW_ASSIST_SCENARIO, runner);
}
