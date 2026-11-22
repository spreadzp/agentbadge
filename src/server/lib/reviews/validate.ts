import { z } from "zod";

import { noCtrlBody, noCtrlStrict } from "../knowledge/types";
import {
  REVIEW_DECLINE_REASONS,
  REVIEW_DECISION_OUTCOMES,
  REVIEW_EVIDENCE_TYPES,
  REVIEW_TYPES,
  CRITERION_RESULTS,
} from "./types";

/**
 * EPIC-230 (SLICE-230-3, D-230-5..8): review input validation.
 * Strict zod predicates at the JSON edge — same posture as
 * feedback/validate.ts (Arc lesson 9: unknown keys refuse).
 */

const CTRL_MSG = "control characters (incl. NUL) not allowed";

export const REVIEW_WORK_REF_MAX = 1000;
export const REVIEW_AGENT_CRITERIA_MAX = 20;
export const REVIEW_AGENT_CRITERIA_LEN = 500;
export const REVIEW_EVIDENCE_LABEL_MAX = 300;
export const REVIEW_EVIDENCE_DESC_MAX = 1000;
export const REVIEW_EVIDENCE_URI_MAX = 1000;
export const REVIEW_SUBMIT_EVIDENCE_MAX = 10;
export const REVIEW_SUMMARY_MAX = 4000;
export const REVIEW_NOTE_MAX = 1000;
export const REVIEW_ID_MAX = 128;

export const reviewIdSchema = z
  .string()
  .min(1)
  .max(REVIEW_ID_MAX)
  .refine(noCtrlStrict, { message: CTRL_MSG });

/** Agent evidence row — validated before it reaches the store. */
export const reviewEvidenceSchema = z
  .object({
    type: z.enum(REVIEW_EVIDENCE_TYPES),
    uri: z
      .string()
      .trim()
      .min(1)
      .max(REVIEW_EVIDENCE_URI_MAX)
      .refine(noCtrlStrict, { message: CTRL_MSG }),
    label: z
      .string()
      .trim()
      .min(1)
      .max(REVIEW_EVIDENCE_LABEL_MAX)
      .refine(noCtrlStrict, { message: CTRL_MSG })
      .nullish(),
    description: z
      .string()
      .trim()
      .min(1)
      .max(REVIEW_EVIDENCE_DESC_MAX)
      .refine(noCtrlBody, { message: CTRL_MSG })
      .nullish(),
  })
  .strict();
export type ReviewEvidenceInput = z.infer<typeof reviewEvidenceSchema>;

/** Agent wishes — free-text operator context, never platform
 *  scoring (D-230-6). */
export const agentCriteriaSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(REVIEW_AGENT_CRITERIA_LEN)
      .refine(noCtrlBody, { message: CTRL_MSG }),
  )
  .max(REVIEW_AGENT_CRITERIA_MAX);

/** Public POST /api/v1/agent/reviews body. */
export const submitReviewSchema = z
  .object({
    reviewType: z.enum(REVIEW_TYPES),
    workRef: z
      .string()
      .trim()
      .min(1)
      .max(REVIEW_WORK_REF_MAX)
      .refine(noCtrlStrict, { message: CTRL_MSG }),
    agentCriteria: agentCriteriaSchema.optional(),
    evidence: z
      .array(reviewEvidenceSchema)
      .max(REVIEW_SUBMIT_EVIDENCE_MAX)
      .optional(),
  })
  .strict();
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;

/** Agent dosylka — POST /reviews/:id/evidence body. */
export const addReviewEvidenceSchema = z
  .object({
    evidence: z.array(reviewEvidenceSchema).min(1).max(REVIEW_SUBMIT_EVIDENCE_MAX),
  })
  .strict();

/** DECLINED requires a closed-vocabulary reason (D-230-5). */
export const declineReasonSchema = z.enum(REVIEW_DECLINE_REASONS);

/** One criterion result inside a decision (D-230-8). */
export const criterionResultSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .refine(noCtrlStrict, { message: CTRL_MSG }),
    result: z.enum(CRITERION_RESULTS),
    note: z
      .string()
      .trim()
      .min(1)
      .max(REVIEW_NOTE_MAX)
      .refine(noCtrlBody, { message: CTRL_MSG })
      .optional(),
  })
  .strict();
export type CriterionResultInput = z.infer<typeof criterionResultSchema>;

export const decideReviewSchema = z
  .object({
    outcome: z.enum(REVIEW_DECISION_OUTCOMES),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(REVIEW_SUMMARY_MAX)
      .refine(noCtrlBody, { message: CTRL_MSG }),
    criteriaResults: z.array(criterionResultSchema).min(1).max(50),
  })
  .strict();
export type DecideReviewInput = z.infer<typeof decideReviewSchema>;
