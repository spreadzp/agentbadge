/**
 * EPIC-232 (SLICE-232-10, spec E10 + D-232-6 + §17.3): on-demand
 * quality metrics — computed by JOINING append-only AiRun rows
 * against the human-side entities (review cases/decisions/events,
 * interaction agreement events) at request time. No materialized
 * metric tables exist by design.
 *
 * §17.3 set: pending reviews, avg review time, reviews/operator,
 * human/AI agreement, reopened cases, rejected AI decisions
 * (assist/supervised), shadow disagreements, false-positive rate,
 * Human Intervention Rate (directional — never a target).
 *
 * Bounded: the projection reads at most `cap` recent runs/reviews —
 * an admin diagnostics view, not a warehouse.
 */

import type { InteractionStore } from "../../request-inbox/interaction-store";
import type { ReviewStore } from "../../reviews/store";
import { getComparator } from "../compare";
import type { AiStore } from "../types";

const CAP = 500;

export interface AiMetricsFilter {
  /** ISO bounds on the primary entity's createdAt (inclusive). */
  from?: string;
  to?: string;
  scenario?: string;
}

export interface ScenarioModeCell {
  scenario: string;
  modeAtTime: string;
  runs: number;
  success: number;
  skipped: number;
  error: number;
}

export interface AiMetrics {
  window: { from: string | null; to: string | null };
  /** Runs grouped by scenario × modeAtTime (shadow kept separate). */
  splits: ScenarioModeCell[];
  reviews: {
    pending: number;
    decided: number;
    reopened: number;
    avgReviewMs: number | null;
    /** decisions grouped by decidedBy → count (reviews/operator). */
    byOperator: Record<string, number>;
  };
  agreement: {
    /** ai.agreement.computed join results on shadow runs. */
    compared: number;
    agreed: number;
    /** §17.3 shadow disagreements — DISTINCT from rejections. */
    disagreed: number;
    notComparable: number;
    /** rejected AI suggestions (assist/supervised UI path). */
    rejectedSuggestions: number;
  };
  /** Linked human decisions (aiRunRef → run). */
  linkage: {
    linked: number;
    /** AI recommended an approving outcome, human rejected/changed. */
    falsePositives: number;
    /** FP / linked — null when nothing linked. */
    falsePositiveRate: number | null;
    /** Human diverged from the AI suggestion — directional only. */
    interventions: number;
    interventionRate: number | null;
  };
}

const inWindow = (
  iso: string | null | undefined,
  f: AiMetricsFilter,
): boolean =>
  !iso ||
  ((!f.from || iso >= f.from) && (!f.to || iso <= f.to));

export async function computeAiMetrics(
  deps: {
    aiStore: AiStore;
    reviews: ReviewStore;
    interactions: InteractionStore;
  },
  filter: AiMetricsFilter = {},
): Promise<AiMetrics> {
  const { aiStore, reviews, interactions } = deps;

  const runs = await aiStore.listRuns({
    scenario: filter.scenario,
    limit: CAP,
  });
  const windowed = runs.filter((r) => inWindow(r.createdAt, filter));
  const runById = new Map(windowed.map((r) => [r.id, r]));

  // ─── per scenario × modeAtTime split ──────────────────────────
  const cells = new Map<string, ScenarioModeCell>();
  for (const r of windowed) {
    const key = `${r.scenario}${r.modeAtTime}`;
    const cell =
      cells.get(key) ??
      {
        scenario: r.scenario,
        modeAtTime: r.modeAtTime,
        runs: 0,
        success: 0,
        skipped: 0,
        error: 0,
      };
    cell.runs += 1;
    if (r.status === "success") cell.success += 1;
    else if (r.status === "skipped") cell.skipped += 1;
    else cell.error += 1;
    cells.set(key, cell);
  }
  const splits = [...cells.values()].sort(
    (a, b) =>
      a.scenario.localeCompare(b.scenario) ||
      a.modeAtTime.localeCompare(b.modeAtTime),
  );

  // ─── shadow agreement join (agent_request subjects only) ──────
  let compared = 0;
  let agreed = 0;
  let disagreed = 0;
  let notComparable = 0;
  for (const r of windowed) {
    if (r.modeAtTime !== "shadow" || r.subjectType !== "agent_request") {
      continue;
    }
    const events = await interactions.listEvents(r.subjectId, {
      visibility: "INTERNAL",
    });
    for (const ev of events) {
      if (
        ev.kind !== "ai.agreement.computed" ||
        (ev.payload as { runId?: unknown })?.runId !== r.id
      ) {
        continue;
      }
      compared += 1;
      const agree = (ev.payload as { agree?: unknown }).agree;
      if (agree === true) agreed += 1;
      else if (agree === false) disagreed += 1;
      else notComparable += 1;
    }
  }

  // ─── review-side metrics (human entities + event joins) ───────
  const cases = await reviews.listReviews({ limit: CAP });
  const inRange = cases.filter((r) => inWindow(r.createdAt, filter));
  const pending = inRange.filter(
    (r) => r.status === "PENDING_TRIAGE" || r.status === "IN_REVIEW",
  ).length;
  const reopened = inRange.filter((r) => r.reopenCount > 0).length;
  const decided = inRange.filter((r) => r.status === "DECIDED");

  let reviewMsSum = 0;
  let reviewMsN = 0;
  const byOperator: Record<string, number> = {};
  let rejectedSuggestions = 0;
  let linked = 0;
  let falsePositives = 0;
  let interventions = 0;

  for (const c of decided) {
    if (c.claimedAt && c.decidedAt) {
      reviewMsSum +=
        new Date(c.decidedAt).getTime() - new Date(c.claimedAt).getTime();
      reviewMsN += 1;
    }
    const [decisions, events] = await Promise.all([
      reviews.listDecisions(c.id),
      reviews.listEvents(c.id),
    ]);
    const rejectedRunIds = new Set(
      events
        .filter((e) => e.kind === "review.ai_suggestion_rejected")
        .map((e) => (e.payload as { runId?: unknown })?.runId),
    );
    rejectedSuggestions += rejectedRunIds.size;

    for (const d of decisions) {
      byOperator[d.decidedBy] = (byOperator[d.decidedBy] ?? 0) + 1;
      if (!d.aiRunRef || !inWindow(d.decidedAt, filter)) continue;
      const run = runById.get(d.aiRunRef);
      if (!run) continue;
      linked += 1;
      const human = {
        outcome: d.outcome,
        criteriaResults: Object.fromEntries(
          (d.criteriaResults as { key: string; result: string }[]).map(
            (cr) => [cr.key, cr.result],
          ),
        ),
      };
      const cmp = getComparator(run.scenario)?.(run.output, human);
      const rec =
        (run.output as { recommendation?: unknown })?.recommendation ?? "";
      if (
        typeof rec === "string" &&
        rec.startsWith("APPROV") &&
        (d.outcome === "REJECTED" || d.outcome === "CHANGES_REQUESTED")
      ) {
        falsePositives += 1;
      }
      if (rejectedRunIds.has(run.id) || cmp?.agree === false) {
        interventions += 1;
      }
    }
  }

  return {
    window: { from: filter.from ?? null, to: filter.to ?? null },
    splits,
    reviews: {
      pending,
      decided: decided.length,
      reopened,
      avgReviewMs: reviewMsN > 0 ? Math.round(reviewMsSum / reviewMsN) : null,
      byOperator,
    },
    agreement: {
      compared,
      agreed,
      disagreed,
      notComparable,
      rejectedSuggestions,
    },
    linkage: {
      linked,
      falsePositives,
      falsePositiveRate: linked > 0 ? falsePositives / linked : null,
      interventions,
      interventionRate: linked > 0 ? interventions / linked : null,
    },
  };
}
