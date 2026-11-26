/**
 * EPIC-232 (232-12 H-9): review-side lazy comparison.
 *
 * `review.decided` (INTERNAL) → lazy shadow comparison on the
 * review_case subject → `ai.agreement.computed` on the review's own
 * event stream. Same one-comparison-per-run dedupe as intake:
 * review_assist shadow agreement needs the decided event, which the
 * intake hook (agent_request subjects) never sees.
 */

import { logger } from "@agentbadge/passport/logger";

import { buildReviewEvent, onReviewEvent } from "../reviews/events";
import type { ReviewStore } from "../reviews/store";
import { getDatabase } from "../database";

import {
  compareShadowRun,
  comparedRunIds,
  registerRunCompletionChecker,
} from "./compare";
import { pickAiStores } from "./db-stores";
import type { AiStore } from "./types";

let _reviewCompareHook: (() => void) | null = null;
let _reviewCheckerOff: (() => void) | null = null;

export function registerAiReviewComparisonHook(opts: {
  aiStore?: AiStore;
  reviews: Pick<ReviewStore, "listDecisions" | "listEvents" | "appendEvents">;
  scenario?: string;
}): () => void {
  if (_reviewCompareHook) return _reviewCompareHook;
  const scenario = opts.scenario ?? "review_assist";

  const compareFor = async (reviewId: string): Promise<void> => {
    const aiStore = opts.aiStore ?? pickAiStores(getDatabase());
    const decision = (await opts.reviews.listDecisions(reviewId)).at(-1);
    if (!decision) return;
    const human: Record<string, unknown> = {
      outcome: decision.outcome,
      criteriaResults: Object.fromEntries(
        (decision.criteriaResults as { key: string; result: string }[]).map(
          (cr) => [cr.key, cr.result],
        ),
      ),
    };
    const prior = comparedRunIds(
      await opts.reviews.listEvents(reviewId, { visibility: "INTERNAL" }),
    );
    const cmp = await compareShadowRun(
      aiStore,
      reviewId,
      scenario,
      human,
      "review_case",
    );
    if (!cmp || prior.has(cmp.run.id)) return;
    await opts.reviews.appendEvents(reviewId, [
      buildReviewEvent("ai.agreement.computed", "INTERNAL", {
        reviewId,
        scenario,
        runId: cmp.run.id,
        promptVersion: cmp.run.promptVersion,
        agree: cmp.result.agree,
        fields: cmp.result.fields,
      }),
    ]);
  };

  _reviewCompareHook = onReviewEvent((reviewId, event) => {
    if (event.kind !== "review.decided" || event.visibility !== "INTERNAL") {
      return;
    }
    void compareFor(reviewId).catch((err) => {
      logger.warn("ai review comparison hook failed", {
        reviewId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  });

  // A review_assist shadow run finishing after the decision still
  // gets scored (dedupe keeps it idempotent).
  _reviewCheckerOff = registerRunCompletionChecker(async (_store, run) => {
    if (run.subjectType !== "review_case" || run.scenario !== scenario) return;
    await compareFor(run.subjectId);
  });

  return _reviewCompareHook;
}

/** Review-side only — the feedback wiring resets just its half. */
export function resetAiReviewComparisonHook(): void {
  _reviewCompareHook?.();
  _reviewCompareHook = null;
  _reviewCheckerOff?.();
  _reviewCheckerOff = null;
}
