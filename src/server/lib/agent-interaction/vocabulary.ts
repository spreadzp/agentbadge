/**
 * EPIC-228 (SLICE-228-2, D-228-5): operator vocabulary + validation
 * for the interaction domain.
 *
 * `intent`/`signalType` are closed dictionaries (a bad value is a
 * typed refusal, never a silent write); `topics`/`entities`/
 * `demandSignals` are open string lists — the "starter" sets below
 * seed the admin UI but operators may enter new values (the
 * dictionary grows by usage, extended via migration-free means).
 */

import {
  INTERACTION_INTENTS,
  INTERACTION_SIGNAL_TYPES,
} from "../request-inbox/interaction-types";

export { INTERACTION_INTENTS, INTERACTION_SIGNAL_TYPES };

/** Starter topic dictionary — admin UI suggestions, not a closed set. */
export const STARTER_TOPICS = [
  "x402",
  "payments",
  "settlement",
  "mcp",
  "a2a",
  "identity",
  "reputation",
  "pricing",
  "api",
  "integration",
] as const;

/** Starter entity/capability names — same open-set rule as topics. */
export const STARTER_ENTITIES = [
  "request-inbox",
  "agent-registration",
  "verdicts",
  "commerce",
  "econ-ledger",
  "surveys",
] as const;

/** Starter demand-signal labels (D-228-5 — «100 questions ≠ 100 buyers»). */
export const STARTER_DEMAND_SIGNALS = [
  "repeat_question",
  "multi_agent_same_intent",
  "willing_to_pay",
  "blocked_on_feature",
  "evaluating_alternative",
] as const;

export const CLASSIFY_STRING_MAX = 64;
export const CLASSIFY_LIST_MAX = 32;
export const CLASSIFY_OUTCOME_MAX = 512;
export const RESPOND_BODY_MAX = 16 * 1024;
export const SESSION_ID_MAX = 128;

export interface ClassifyInput {
  intent?: string | null;
  signalType?: string | null;
  outcome?: string | null;
  knowledgeGap?: boolean;
  topics?: unknown;
  entities?: unknown;
  demandSignals?: unknown;
}

export type ClassifyValidation =
  | {
      ok: true;
      patch: {
        intent?: string | null;
        signalType?: string | null;
        outcome?: string | null;
        knowledgeGap?: boolean;
        topics?: string[] | null;
        entities?: string[] | null;
        demandSignals?: string[] | null;
      };
    }
  | { ok: false; error: string; field: string };

/** Trim + bound a free-string list; non-string/oversized → error. */
const sanitizeList = (
  v: unknown,
  field: string,
): { ok: true; list: string[] } | { ok: false; error: string; field: string } => {
  if (v == null) return { ok: true, list: [] };
  if (!Array.isArray(v)) {
    return { ok: false, error: `${field} must be an array`, field };
  }
  if (v.length > CLASSIFY_LIST_MAX) {
    return { ok: false, error: `${field} too many items`, field };
  }
  const list: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") {
      return { ok: false, error: `${field} items must be strings`, field };
    }
    const s = item.trim();
    if (s.length === 0) continue;
    if (s.length > CLASSIFY_STRING_MAX) {
      return { ok: false, error: `${field} item too long`, field };
    }
    if (!list.includes(s)) list.push(s);
  }
  return { ok: true, list };
};

/**
 * Normalize a raw classify request body → store patch. Only provided
 * keys land in the patch (partial updates keep unset fields).
 */
export function validateClassifyInput(input: ClassifyInput): ClassifyValidation {
  const patch: NonNullable<
    Extract<ClassifyValidation, { ok: true }>["patch"]
  > = {};

  if (input.intent !== undefined) {
    if (input.intent !== null && !INTERACTION_INTENTS.includes(input.intent as never)) {
      return { ok: false, error: "unknown intent", field: "intent" };
    }
    patch.intent = input.intent;
  }
  if (input.signalType !== undefined) {
    if (
      input.signalType !== null &&
      !INTERACTION_SIGNAL_TYPES.includes(input.signalType as never)
    ) {
      return { ok: false, error: "unknown signalType", field: "signalType" };
    }
    patch.signalType = input.signalType;
  }
  if (input.outcome !== undefined) {
    if (input.outcome !== null) {
      if (typeof input.outcome !== "string") {
        return { ok: false, error: "outcome must be a string", field: "outcome" };
      }
      if (input.outcome.length > CLASSIFY_OUTCOME_MAX) {
        return { ok: false, error: "outcome too long", field: "outcome" };
      }
    }
    patch.outcome = input.outcome;
  }
  if (input.knowledgeGap !== undefined) {
    if (typeof input.knowledgeGap !== "boolean") {
      return {
        ok: false,
        error: "knowledgeGap must be boolean",
        field: "knowledgeGap",
      };
    }
    patch.knowledgeGap = input.knowledgeGap;
  }
  for (const key of ["topics", "entities", "demandSignals"] as const) {
    if (input[key] === undefined) continue;
    const res = sanitizeList(input[key], key);
    if (!res.ok) return res;
    patch[key] = res.list;
  }
  return { ok: true, patch };
}
