/**
 * EPIC-232 (SLICE-232-12, arc 232-11 H-4): server-side output
 * validation — the provider's json_schema is a REQUEST, not a
 * guarantee (local vLLM/Ollama endpoints may ignore it entirely).
 * Every stored run output is parsed against the per-scenario zod
 * contract before it lands as status=success; a violation is
 * recorded as `invalid_json` and burns an attempt honestly.
 *
 * Schemas mirror the request-side JSON schemas — keep both in sync
 * when a scenario contract changes.
 */

import { z } from "zod";

import { INTERACTION_INTENTS } from "../request-inbox/interaction-types";
import { REQUEST_KINDS } from "../request-inbox/intake";
import {
  FEEDBACK_ITEM_TYPES,
  FEEDBACK_SENTIMENTS,
} from "./feedback-runner";
import { REVIEW_ASSIST_RECOMMENDATIONS } from "./review-runner";

const confidence = z.number().min(0).max(1);

const classification = z
  .object({
    category: z.enum(REQUEST_KINDS),
    intent: z.enum(INTERACTION_INTENTS),
    capabilities: z.array(z.string()).max(5),
    confidence,
  })
  .strict();

const summary = z
  .object({
    summary: z.string(),
    keyFacts: z.array(z.string()).max(6),
    confidence,
  })
  .strict();

const knowledgeSearch = z
  .object({
    query: z.string(),
    matchedEntryIds: z.array(z.string()).max(8),
    scores: z
      .array(
        z
          .object({ id: z.string(), relevance: confidence })
          .strict(),
      )
      .max(8),
    confidence,
  })
  .strict();

const answerDraft = z
  .object({
    draftText: z.string(),
    usedKnowledgeIds: z.array(z.string()).max(10),
    tone: z.enum(["brief", "detailed", "clarifying"]),
    confidence,
  })
  .strict();

const feedbackExtract = z
  .object({
    items: z
      .array(
        z
          .object({
            type: z.enum(FEEDBACK_ITEM_TYPES),
            text: z.string(),
            sentiment: z.enum(FEEDBACK_SENTIMENTS),
            confidence,
          })
          .strict(),
      )
      .max(8),
    overallConfidence: confidence,
  })
  .strict();

const reviewAssist = z
  .object({
    criteria: z
      .array(
        z
          .object({
            name: z.string(),
            passed: z.boolean(),
            evidence: z.string().nullable().optional(),
            confidence,
          })
          .strict(),
      )
      .max(20),
    recommendation: z.enum(REVIEW_ASSIST_RECOMMENDATIONS),
    confidence,
  })
  .strict();

const schemas: Record<string, z.ZodType<unknown>> = {
  classification,
  summary,
  knowledge_search: knowledgeSearch,
  answer_draft: answerDraft,
  feedback_extract: feedbackExtract,
  review_assist: reviewAssist,
};

/**
 * Validate a parsed provider output against the scenario contract.
 * Returns null on success, else a bounded reason string for the
 * invalid_json run row. Unregistered scenarios pass (runner-provided
 * validateOutput still applies).
 */
export function validateScenarioOutput(
  scenario: string,
  output: unknown,
): string | null {
  const schema = schemas[scenario];
  if (!schema) return null;
  const r = schema.safeParse(output);
  if (r.success) return null;
  const issue = r.error.issues[0];
  return `output_schema: ${issue?.path.join(".") || "?"} ${issue?.message ?? "invalid"}`.slice(
    0,
    200,
  );
}
