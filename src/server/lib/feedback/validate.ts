import { z } from "zod";

import { noCtrlBody, noCtrlStrict } from "../knowledge/types";
import {
  FEEDBACK_KINDS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_TARGETS,
} from "./types";

/**
 * EPIC-230 (SLICE-230-2, D-230-4): feedback input validation.
 *
 * Strict zod predicates at the JSON edge (Arc lesson 9): the schema
 * is `.strict()` — unknown keys refuse rather than silently drop.
 * Control-char policy mirrors knowledge: multi-line `text` uses
 * noCtrlBody (\t \n \r legal, Trojan-Source/C0/C1 refused); single-
 * line fields use noCtrlStrict.
 */

export const FEEDBACK_TEXT_MAX = 16 * 1024;
export const FEEDBACK_SUGGESTION_MAX = 1000;
export const FEEDBACK_ID_MAX = 128;

const CTRL_MSG = "control characters (incl. NUL) not allowed";

export const feedbackTextSchema = z
  .string()
  .min(1)
  .max(FEEDBACK_TEXT_MAX)
  .refine(noCtrlBody, { message: CTRL_MSG })
  .refine((v) => v.trim().length > 0, {
    message: "text must not be blank",
  });

/** Public POST body — agent submits feedback (D-230-4). */
export const submitFeedbackSchema = z
  .object({
    text: feedbackTextSchema,
    kind: z.enum(FEEDBACK_KINDS).optional(),
    target: z.enum(FEEDBACK_TARGETS).optional(),
    // Agent hint only — operator may rewrite at triage (§16.2).
    severity: z.enum(FEEDBACK_SEVERITIES).optional(),
  })
  .strict();
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

/** Operator triage patch — dictionary fields + public suggestion. */
export const triageFeedbackSchema = z
  .object({
    kind: z.enum(FEEDBACK_KINDS).nullish(),
    target: z.enum(FEEDBACK_TARGETS).nullish(),
    severity: z.enum(FEEDBACK_SEVERITIES).nullish(),
    suggestion: z
      .string()
      .trim()
      .min(1)
      .max(FEEDBACK_SUGGESTION_MAX)
      .refine(noCtrlStrict, { message: CTRL_MSG })
      .nullish(),
  })
  .strict();
export type TriageFeedbackInput = z.infer<typeof triageFeedbackSchema>;

/** Route-param id guard — same strict predicate as :id paths. */
export const feedbackIdSchema = z
  .string()
  .min(1)
  .max(FEEDBACK_ID_MAX)
  .refine(noCtrlStrict, { message: CTRL_MSG });
