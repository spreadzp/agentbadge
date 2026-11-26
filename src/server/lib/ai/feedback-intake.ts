/**
 * EPIC-232 (SLICE-232-6, E5): feedback/review intake seam — enqueue
 * `feedback_extract` AiJobs when a feedback row or review case
 * commits, riding the post-commit event hooks
 * (feedback/events.ts + reviews/events.ts — the TG-notify seam
 * precedent: fire-and-forget, post-commit, never on the write path).
 *
 * inputHash = sha256 of the INTERNAL event payload — the immutable
 * snapshot the comparison base requires (feedback payload carries
 * `text` verbatim; review payload carries the case fields +
 * evidenceCount — evidence rows are appended in the same commit and
 * immutable at submit time).
 */

import { createHash } from "node:crypto";

import { getConfig } from "../../../config/env";
import type { AiEnvConfig } from "../../../config/env/ai-types";
import { getDatabase } from "../database";
import { onFeedbackEvent } from "../feedback/events";
import { onReviewEvent } from "../reviews/events";
import type { FeedbackStore } from "../feedback/store";
import type { ReviewStore } from "../reviews/store";
import { pickFeedbackStore } from "../feedback/db-stores";
import { pickReviewStore } from "../reviews/db-stores";

import { pickAiStores } from "./db-stores";
import {
  registerAiReviewComparisonHook,
  resetAiReviewComparisonHook,
} from "./compare-review";
import { registerFeedbackExtractRunner } from "./feedback-runner";
import { registerReviewAssistRunner } from "./review-runner";
import { enqueueAiJob } from "./jobs";
import type { AiStore } from "./types";

interface FeedbackHookOpts {
  aiStore?: AiStore;
  /** Read per-event so a kill-switch flip takes effect immediately. */
  config?: () => AiEnvConfig | undefined;
}

let _feedbackHook: (() => void) | null = null;
let _reviewHook: (() => void) | null = null;

function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload ?? null))
    .digest("hex");
}

/** Scenarios enqueued per domain event on that subject (E5 + E6). */
const SUBJECT_SCENARIOS: Record<string, readonly string[]> = {
  feedback: ["feedback_extract"],
  // 232-7 E6: review cases get extraction AND the review assistant —
  // subjectType `review_case` is the canonical join key (spec E6).
  review_case: ["feedback_extract", "review_assist"],
};

async function enqueue(
  aiStore: AiStore,
  subjectType: string,
  subjectId: string,
  inputHash: string,
  queueCap?: number,
): Promise<void> {
  for (const scenario of SUBJECT_SCENARIOS[subjectType] ?? []) {
    const policy = await aiStore.getPolicy(scenario);
    if ((policy?.mode ?? "off") === "off") continue;
    await enqueueAiJob(
      aiStore,
      {
        scenario,
        subjectType,
        subjectId,
        inputRef: `${subjectType}:${subjectId}`,
        inputHash,
      },
      { queueCap },
    );
  }
}

/**
 * INTERNAL feedback.received → enqueue on the `feedback` subject.
 * Returns an unsubscribe fn; second call while registered is a no-op.
 */
export function registerAiFeedbackHook(
  opts: FeedbackHookOpts = {},
): () => void {
  if (_feedbackHook) return _feedbackHook;
  const readCfg = opts.config ?? (() => getConfig().ai);
  _feedbackHook = onFeedbackEvent((feedbackId, event) => {
    if (
      event.kind !== "feedback.received" ||
      event.visibility !== "INTERNAL"
    ) {
      return;
    }
    const cfg = readCfg();
    if (!cfg?.enabled) return; // kill-switch — never even queue
    const store = opts.aiStore ?? pickAiStores(getDatabase());
    void enqueue(
      store,
      "feedback",
      feedbackId,
      hashPayload(event.payload),
      cfg.jobQueueCap,
    ).catch(() => {
      /* fire-and-forget: enqueue failure must not surface at intake */
    });
  });
  return _feedbackHook;
}

/** INTERNAL review.submitted → enqueue on the `review` subject. */
export function registerAiReviewHook(
  opts: FeedbackHookOpts = {},
): () => void {
  if (_reviewHook) return _reviewHook;
  const readCfg = opts.config ?? (() => getConfig().ai);
  _reviewHook = onReviewEvent((reviewId, event) => {
    if (
      event.kind !== "review.submitted" ||
      event.visibility !== "INTERNAL"
    ) {
      return;
    }
    const cfg = readCfg();
    if (!cfg?.enabled) return;
    const store = opts.aiStore ?? pickAiStores(getDatabase());
    void enqueue(
      store,
      "review_case",
      reviewId,
      hashPayload(event.payload),
      cfg.jobQueueCap,
    ).catch(() => {
      /* fire-and-forget */
    });
  });
  return _reviewHook;
}

/** Test hook — unsubscribes + clears process-global registrations. */
export function resetAiFeedbackHooks(): void {
  _feedbackHook?.();
  _feedbackHook = null;
  _reviewHook?.();
  _reviewHook = null;
  // The review-side comparison hook is wired alongside ours.
  resetAiReviewComparisonHook();
}

/**
 * One-call wiring (background.ts): bind the 230 stores into the
 * feedback_extract runner + register both enqueue hooks.
 * `feedback`/`reviews` explicit null → the matching subjects degrade
 * to seam_unavailable skips (232-4 contract).
 */
export function wireAiFeedback(
  deps: {
    aiStore?: AiStore;
    feedback?: FeedbackStore | null;
    reviews?: ReviewStore | null;
    config?: () => AiEnvConfig | undefined;
  } = {},
): void {
  const db = getDatabase();
  const reviews =
    deps.reviews === undefined ? pickReviewStore(db) : deps.reviews;
  registerFeedbackExtractRunner({
    feedback:
      deps.feedback === undefined
        ? pickFeedbackStore(db)
        : deps.feedback,
    reviews,
  });
  // 232-7 E6: the review assistant shares the same review_case seam.
  registerReviewAssistRunner({ reviews });
  registerAiFeedbackHook({ aiStore: deps.aiStore, config: deps.config });
  registerAiReviewHook({ aiStore: deps.aiStore, config: deps.config });
  // 232-12 E6/H-9: review_assist shadow agreement — lazy comparison
  // on review.decided + run-completion coverage (dedupe-per-run).
  if (reviews) {
    registerAiReviewComparisonHook({ reviews, aiStore: deps.aiStore });
  }
}
