import type { ReviewDecisionRecord } from "./types";
import type {
  ReviewDecideInput,
  ReviewDecideResult,
  ReviewEventInput,
} from "./store";
import {
  cloneCase,
  type AppendEvents,
  type ReviewMemoryData,
} from "./store-memory";

/**
 * EPIC-230 (SLICE-230-1, D-230-8): memory decision ops — append-only
 * decisions + the atomic IN_REVIEW→DECIDED flip, split per
 * store-memory-*.ts convention.
 */

const cloneDec = (d: ReviewDecisionRecord): ReviewDecisionRecord => ({
  ...d,
  criteriaResults:
    d.criteriaResults == null
      ? d.criteriaResults
      : structuredClone(d.criteriaResults),
});

export function createMemoryDecisionOps(
  data: ReviewMemoryData,
  appendEventsMem: AppendEvents,
  now: () => string,
) {
  const { cases, decisions } = data;
  return {
    async decideReview(
      id: string,
      input: ReviewDecideInput,
      event: ReviewEventInput,
    ): Promise<ReviewDecideResult> {
      const cur = cases.get(id);
      if (!cur) {
        return {
          record: null,
          decision: null,
          event: null,
          transitioned: false,
          reason: "missing",
        };
      }
      if (cur.status !== "IN_REVIEW") {
        return {
          record: cloneCase(cur),
          decision: null,
          event: null,
          transitioned: false,
          reason: "status_mismatch",
        };
      }
      const list = decisions.get(id) ?? [];
      const seq = list.reduce((m, d) => Math.max(m, d.seq), 0) + 1;
      const t = input.now ?? now();
      const decision: ReviewDecisionRecord = {
        id: `rd_${crypto.randomUUID()}`,
        reviewId: id,
        seq,
        outcome: input.outcome,
        criteriaResults: input.criteriaResults,
        summary: input.summary,
        decidedBy: input.decidedBy,
        decidedAt: t,
      };
      list.push(decision);
      decisions.set(id, list);
      cur.status = "DECIDED";
      cur.decidedAt = t;
      cur.deliveredAt = t; // D-230-5: delivery automatic at DECIDED
      cur.latestDecisionSeq = seq;
      cur.updatedAt = t;
      const appended = appendEventsMem(id, [event]);
      return {
        record: cloneCase(cur),
        decision: cloneDec(decision),
        event: appended[0]!,
        transitioned: true,
      };
    },

    async listDecisions(reviewId: string): Promise<ReviewDecisionRecord[]> {
      return [...(decisions.get(reviewId) ?? [])]
        .sort((a, b) => a.seq - b.seq)
        .map(cloneDec);
    },
  };
}
