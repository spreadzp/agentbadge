/**
 * EPIC-232 (SLICE-232-10): per-scenario comparator registry.
 *
 * A comparator takes a shadow AiRun's parsed output + the human
 * outcome fields and returns per-field agreement — the honest
 * blind signal (the run was invisible while the human decided).
 * Scenarios without a human-outcome counterpart register the
 * null comparator (honest n/a, never fabricated agreement).
 */

/** Per-field agreement verdict for the audit event. */
export interface FieldAgreement {
  field: string;
  ai: unknown;
  human: unknown;
  match: boolean;
}

export interface AgreementResult {
  /** null → no comparable human field (summary, etc.). */
  agree: boolean | null;
  fields: FieldAgreement[];
}

/**
 * Comparator: shadow run output vs the human-classified record.
 * `human` is the record's classification patch (intent/kind/...).
 */
export type AiComparator = (
  output: unknown,
  human: Record<string, unknown>,
) => AgreementResult;

const comparators = new Map<string, AiComparator>();

export function registerComparator(
  scenario: string,
  fn: AiComparator,
): void {
  comparators.set(scenario, fn);
}

export function getComparator(scenario: string): AiComparator | undefined {
  return comparators.get(scenario);
}

/** Test hook — registry is process-global. */
export function resetComparators(): void {
  comparators.clear();
  registerDefaultComparators();
}

/** classification: intent exact-match only. Delta-2 H-9: the
 * category-vs-`kind` field was dropped — `kind` is agent-declared
 * and visible inside the prompt, so the model was scored against
 * input it could see (agreement was self-confirming, not
 * independent). */
function classificationComparator(
  output: unknown,
  human: Record<string, unknown>,
): AgreementResult {
  const out = (output ?? {}) as Record<string, unknown>;
  const fields: FieldAgreement[] = [];
  if (typeof human.intent === "string") {
    fields.push({
      field: "intent",
      ai: out.intent ?? null,
      human: human.intent,
      match: out.intent === human.intent,
    });
  }
  const comparable = fields.filter((f) => f.ai !== null);
  return {
    agree: comparable.length === 0 ? null : comparable.every((f) => f.match),
    fields,
  };
}

/** summary has no human field to compare against — agreement n/a. */
function nullComparator(): AgreementResult {
  return { agree: null, fields: [] };
}

/**
 * 232-10: answer_draft — human outcome is the response record
 * ({body}); verbatim send = agreement, any edit = disagreement on
 * the single "verbatim" field.
 */
function answerDraftComparator(
  output: unknown,
  human: Record<string, unknown>,
): AgreementResult {
  const out = (output ?? {}) as Record<string, unknown>;
  if (typeof out.draftText !== "string" || typeof human.body !== "string") {
    return { agree: null, fields: [] };
  }
  const match = out.draftText === human.body;
  return {
    agree: match,
    fields: [{ field: "verbatim", ai: out.draftText, human: human.body, match }],
  };
}

/** 232-12 H-9: AI vocabulary → human outcome vocabulary
 *  (APPROVE→APPROVED, REJECT→REJECTED — the comparator compares
 *  semantics, not spellings). */
export function humanOutcomeFor(recommendation: string): string {
  switch (recommendation) {
    case "APPROVE":
      return "APPROVED";
    case "APPROVE_WITH_NOTES":
      return "APPROVED_WITH_NOTES";
    case "REJECT":
      return "REJECTED";
    default:
      return recommendation;
  }
}

/**
 * 232-10: review_assist — human outcome is the decide payload
 * ({criteriaResults: {key:result}, outcome}); agreement = every
 * comparable criterion matches AND the outcome equals the
 * recommendation. Fields expose per-criterion + outcome diffs.
 */
function reviewAssistComparator(
  output: unknown,
  human: Record<string, unknown>,
): AgreementResult {
  const out = (output ?? {}) as {
    criteria?: { name?: string; passed?: boolean }[];
    recommendation?: string;
  };
  const humanCriteria = (human.criteriaResults ?? {}) as Record<
    string,
    string
  >;
  const fields: FieldAgreement[] = [];
  for (const c of out.criteria ?? []) {
    if (typeof c.name !== "string" || typeof c.passed !== "boolean") continue;
    const h = humanCriteria[c.name];
    if (h !== "PASS" && h !== "FAIL") continue; // human NA/absent → n/a
    const ai = c.passed ? "PASS" : "FAIL";
    fields.push({ field: `criterion:${c.name}`, ai, human: h, match: ai === h });
  }
  if (typeof out.recommendation === "string" && typeof human.outcome === "string") {
    const aiOutcome = humanOutcomeFor(out.recommendation);
    fields.push({
      field: "outcome",
      ai: aiOutcome,
      human: human.outcome,
      match: aiOutcome === human.outcome,
    });
  }
  const comparable = fields.filter((f) => f.ai !== null);
  return {
    agree: comparable.length === 0 ? null : comparable.every((f) => f.match),
    fields,
  };
}

function registerDefaultComparators(): void {
  registerComparator("classification", classificationComparator);
  registerComparator("summary", nullComparator);
  // 232-10: full shipped-scenario coverage. knowledge_search /
  // feedback_extract have no human-outcome counterpart (retrieval /
  // extraction artifacts) → honest n/a comparators.
  registerComparator("knowledge_search", nullComparator);
  registerComparator("answer_draft", answerDraftComparator);
  registerComparator("feedback_extract", nullComparator);
  registerComparator("review_assist", reviewAssistComparator);
}
registerDefaultComparators();
