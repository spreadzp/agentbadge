/**
 * EPIC-232 (SLICE-232-3, D-232-5): lazy shadow comparison.
 *
 * When the HUMAN outcome lands on a subject (operator classifies the
 * interaction), we compare it against the latest SHADOW AiRun —
 * blind-by-construction: the run was invisible to the operator while
 * deciding, so agreement is an honest signal. Results are recorded
 * as INTERNAL `ai.agreement.computed` interaction events — the
 * append-only audit trail 232-10's on-demand metrics join against;
 * no new tables.
 *
 * Comparators live in a registry — this slice ships stubs; the full
 * per-scenario comparators (knowledge_search hit-rate, feedback
 * extraction f1, ...) land in 232-10 once shadow data exists to
 * calibrate them (O2).
 */

import type { RequestInboxStores } from "../request-inbox/store";
import {
  buildEvent,
  onInteractionEvent,
  recordEvent,
} from "../agent-interaction/events";
import { logger } from "@agentbadge/passport/logger";

import { pickAiStores } from "./db-stores";
import type { AiRunRecord, AiStore } from "./types";
import { getDatabase } from "../database";
import { pickRequestInboxStores } from "../request-inbox/db-stores";

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

// ─── stub comparators (232-10 replaces with calibrated versions) ──

/** classification: intent exact-match + category vs declared kind. */
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
  if (typeof human.kind === "string" && human.kind) {
    fields.push({
      field: "category",
      ai: out.category ?? null,
      human: human.kind,
      match: out.category === human.kind,
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
    fields.push({
      field: "outcome",
      ai: out.recommendation,
      human: human.outcome,
      match: out.recommendation === human.outcome,
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

// ─── lazy comparison ────────────────────────────────────────────

/**
 * Compare the latest SHADOW run for `requestId` against the human
 * outcome fields (`human.intent`/`human.kind` — operator-set record
 * fields). Returns null when no shadow run exists (nothing shadowed
 * — nothing to compare).
 */
export async function compareShadowRun(
  aiStore: AiStore,
  requestId: string,
  scenario: string,
  human: Record<string, unknown>,
): Promise<{ run: AiRunRecord; result: AgreementResult } | null> {
  const run = await aiStore.latestRunFor("agent_request", requestId, scenario);
  if (!run || run.modeAtTime !== "shadow" || run.status !== "success") {
    return null;
  }
  const cmp = getComparator(scenario);
  const result = cmp
    ? cmp(run.output, human)
    : { agree: null, fields: [] };
  return { run, result };
}

// ─── trigger: human outcome event → comparison → audit event ────

export interface CompareHookOpts {
  aiStore?: AiStore;
  stores?: RequestInboxStores;
  scenarios?: readonly string[];
}

let _compareHook: (() => void) | null = null;

/**
 * `interaction.request.classified` (INTERNAL) → per-scenario lazy
 * comparison → INTERNAL `ai.agreement.computed` event. Dedupe: one
 * comparison per (scenario, run) — a re-classify against the same
 * shadow run re-computes honestly (the human changed, not the AI).
 */
export function registerAiComparisonHook(
  opts: CompareHookOpts = {},
  scenarios: readonly string[] = ["classification", "summary"],
): () => void {
  if (_compareHook) return _compareHook;
  _compareHook = onInteractionEvent((requestId, event) => {
    if (
      event.kind !== "interaction.request.classified" ||
      event.visibility !== "INTERNAL"
    ) {
      return;
    }
    const stores = opts.stores ?? pickRequestInboxStores(getDatabase());
    const aiStore = opts.aiStore ?? pickAiStores(getDatabase());
    const patch =
      ((event.payload as Record<string, unknown> | null)?.patch ?? {}) as
        Record<string, unknown>;
    void (async () => {
      const record = await stores.requests.get(requestId);
      const human: Record<string, unknown> = {
        kind: record.record?.kind ?? null,
        ...patch, // classified patch wins (intent, signalType, ...)
      };
      for (const scenario of scenarios) {
        const cmp = await compareShadowRun(aiStore, requestId, scenario, human);
        if (!cmp) continue;
        await recordEvent(
          stores,
          requestId,
          buildEvent("ai.agreement.computed", "INTERNAL", {
            requestId,
            scenario,
            runId: cmp.run.id,
            promptVersion: cmp.run.promptVersion,
            agree: cmp.result.agree,
            fields: cmp.result.fields,
          }),
        );
      }
    })().catch((err) => {
      logger.warn("ai comparison hook failed", {
        requestId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  });
  return _compareHook;
}

/** Test hook — unsubscribes + clears registration. */
export function resetAiComparisonHook(): void {
  _compareHook?.();
  _compareHook = null;
}
