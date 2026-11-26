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

import { getComparator } from "./comparators";
import type { AgreementResult } from "./comparators";
import { resetAiReviewComparisonHook } from "./compare-review";
import { pickAiStores } from "./db-stores";
import type { AiRunRecord, AiStore } from "./types";
import { getDatabase } from "../database";
import { pickRequestInboxStores } from "../request-inbox/db-stores";

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
  /** 232-12 H-9: polymorphic — review_case comparisons share it. */
  subjectType: string = "agent_request",
): Promise<{ run: AiRunRecord; result: AgreementResult } | null> {
  // Delta-2 N-H1: newest SHADOW SUCCESS run — a newer error row from
  // a stale claim must not hide the shadow answer from comparison
  // (that is exactly the selection bias H-9 removed).
  const runs = await aiStore.listRuns({
    subjectType,
    subjectId: requestId,
    scenario,
    limit: 10,
  });
  const run = runs.find(
    (r) => r.modeAtTime === "shadow" && r.status === "success",
  );
  if (!run) {
    return null;
  }
  const cmp = getComparator(scenario);
  const result = cmp
    ? cmp(run.output, human)
    : { agree: null, fields: [] };
  return { run, result };
}

/** runIds that already produced an agreement event — dedupe key
 *  (H-2: one comparison per run, first human outcome wins). */
export function comparedRunIds(
  events: { kind: string; payload: unknown }[],
): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.kind !== "ai.agreement.computed") continue;
    const id = (e.payload as { runId?: unknown })?.runId;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

// ─── trigger: human outcome event → comparison → audit event ────

export interface CompareHookOpts {
  aiStore?: AiStore;
  stores?: RequestInboxStores;
  scenarios?: readonly string[];
}

let _compareHook: (() => void) | null = null;
let _compareCheckerOff: (() => void) | null = null;

/**
 * `interaction.request.classified` (INTERNAL) → per-scenario lazy
 * comparison → INTERNAL `ai.agreement.computed` event.
 *
 * 232-12 H-2: one comparison per run — the FIRST human outcome is
 * the blind one; a re-classify after the shadow answer showed up on
 * the timeline must not re-score it.
 *
 * 232-12 H-9: `interaction.response.sent` additionally triggers the
 * answer_draft comparison (human outcome = response body), and a
 * run-completion checker covers shadow runs that finish AFTER the
 * human outcome already landed — otherwise those runs silently
 * bias agreement upward by never being compared at all.
 */
export function registerAiComparisonHook(
  opts: CompareHookOpts = {},
  scenarios: readonly string[] = ["classification", "summary"],
): () => void {
  if (_compareHook) return _compareHook;
  const stores = () => opts.stores ?? pickRequestInboxStores(getDatabase());
  const aiStore = () => opts.aiStore ?? pickAiStores(getDatabase());
  const compareFor = async (
    requestId: string,
    human: Record<string, unknown>,
    which: readonly string[],
  ): Promise<void> => {
    const prior = comparedRunIds(
      await stores().interactions.listEvents(requestId, {
        visibility: "INTERNAL",
      }),
    );
    for (const scenario of which) {
      const cmp = await compareShadowRun(
        aiStore(),
        requestId,
        scenario,
        human,
      );
      if (!cmp || prior.has(cmp.run.id)) continue;
      await recordEvent(
        stores(),
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
      prior.add(cmp.run.id);
    }
  };

  _compareHook = onInteractionEvent((requestId, event) => {
    if (event.kind === "interaction.request.classified") {
      if (event.visibility !== "INTERNAL") return;
      const patch =
        ((event.payload as Record<string, unknown> | null)?.patch ?? {}) as
          Record<string, unknown>;
      void (async () => {
        const record = await stores().requests.get(requestId);
        await compareFor(
          requestId,
          {
            kind: record.record?.kind ?? null,
            ...patch, // classified patch wins (intent, signalType, ...)
          },
          scenarios,
        );
      })().catch((err) => {
        logger.warn("ai comparison hook failed", {
          requestId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }
    // 232-12: answer_draft human outcome is the response the
    // operator actually sent (verbatim = agreement).
    if (event.kind === "interaction.response.sent") {
      const body = (event.payload as Record<string, unknown> | null)?.body;
      if (typeof body !== "string") return;
      void compareFor(requestId, { body }, ["answer_draft"]).catch((err) => {
        logger.warn("ai draft comparison hook failed", {
          requestId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // Late-run coverage: a shadow run that finishes after the human
  // outcome still gets scored — dedupe keeps it idempotent.
  _compareCheckerOff = registerRunCompletionChecker(async (_store, run) => {
    if (run.subjectType !== "agent_request") return;
    const record = await stores().requests.get(run.subjectId);
    const rec = record.record;
    if (!rec || !rec.classifiedBy) return; // human outcome not landed yet
    const human: Record<string, unknown> = {
      kind: rec.kind ?? null,
      intent: rec.intent ?? null,
      signalType: rec.signalType ?? null,
    };
    const body = (rec.response as { answer?: unknown } | null)?.answer;
    const which: string[] = [...scenarios];
    if (typeof body === "string") {
      human.body = body;
      which.push("answer_draft");
    }
    await compareFor(run.subjectId, human, which);
  });

  return _compareHook;
}

/** Test hook — unsubscribes + clears registration. */
export function resetAiComparisonHook(): void {
  _compareHook?.();
  _compareHook = null;
  _compareCheckerOff?.();
  _compareCheckerOff = null;
  resetAiReviewComparisonHook();
  _runCompletionCheckers.clear(); // manual registrations too — full reset
}

// ─── run-completion checkers (232-12 H-9: a shadow run finishing
//      AFTER the human outcome still deserves its comparison —
//      the event hook already fired and missed it) ─

export type RunCompletionChecker = (
  aiStore: AiStore,
  run: AiRunRecord,
) => Promise<void>;

const _runCompletionCheckers = new Set<RunCompletionChecker>();

/** Returns an unregister fn — partial resets remove only their own. */
export function registerRunCompletionChecker(
  fn: RunCompletionChecker,
): () => void {
  _runCompletionCheckers.add(fn);
  return () => {
    _runCompletionCheckers.delete(fn);
  };
}

/** Called by the worker after every success run row is appended. */
export async function notifyAiRunAppended(
  aiStore: AiStore,
  run: AiRunRecord,
): Promise<void> {
  if (run.modeAtTime !== "shadow" || run.status !== "success") return;
  for (const fn of _runCompletionCheckers) {
    await fn(aiStore, run).catch((err) => {
      logger.warn("ai run-completion checker failed", {
        runId: run.id,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }
}