import type {
  ReviewRepository,
  ReviewEventInput as RepoEventInput,
  ReviewEvidenceInsert as RepoEvidenceInsert,
} from "@agentbadge/database";

import type {
  ReviewDecideResult,
  ReviewStore,
  ReviewTransitionResult,
} from "./store";
import type {
  ReviewCaseRecord,
  ReviewDecisionRecord,
  ReviewEventRecord,
  ReviewEvidenceRecord,
} from "./types";

/**
 * EPIC-230 (SLICE-230-1): Postgres adapter — ReviewRepository rows
 * → ReviewStore domain records (interaction-store-db.ts precedent).
 * The interface never leaks Models.* types.
 */

type CaseRow = NonNullable<
  Awaited<ReturnType<ReviewRepository["getReview"]>>
>;
type EvidenceRow = Awaited<
  ReturnType<ReviewRepository["listEvidence"]>
>[number];
type DecisionRow = Awaited<
  ReturnType<ReviewRepository["listDecisions"]>
>[number];
type EventRow = Awaited<
  ReturnType<ReviewRepository["listEvents"]>
>[number];

const toRecord = (r: CaseRow): ReviewCaseRecord => ({
  id: r.id,
  actorResolution: r.actorResolution,
  actorRef: r.actorRef,
  dedupeScope: r.dedupeScope,
  idempotencyKey: r.idempotencyKey,
  reviewType: r.reviewType,
  workRef: r.workRef,
  agentCriteria: r.agentCriteria as unknown,
  status: r.status,
  assignee: r.assignee,
  claimedAt: r.claimedAt,
  decidedAt: r.decidedAt,
  deliveredAt: r.deliveredAt,
  declineReason: r.declineReason,
  reopenCount: r.reopenCount,
  latestDecisionSeq: r.latestDecisionSeq,
  knowledgeConverted: r.knowledgeConverted,
  knowledgeItemId: r.knowledgeItemId,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toEvidence = (r: EvidenceRow): ReviewEvidenceRecord => ({
  id: r.id,
  reviewId: r.reviewId,
  type: r.type,
  uri: r.uri,
  label: r.label,
  description: r.description,
  submittedBy: r.submittedBy,
  createdAt: r.createdAt,
});

const toDecision = (r: DecisionRow): ReviewDecisionRecord => ({
  id: r.id,
  reviewId: r.reviewId,
  seq: r.seq,
  outcome: r.outcome,
  criteriaResults: r.criteriaResults as unknown,
  summary: r.summary,
  decidedBy: r.decidedBy,
  aiRunRef: r.aiRunRef ?? null,
  decidedAt: r.decidedAt,
});

const toEvent = (r: EventRow): ReviewEventRecord => ({
  id: r.id,
  reviewId: r.reviewId,
  seq: r.seq,
  kind: r.kind,
  visibility: r.visibility,
  payload: r.payload as unknown,
  createdAt: r.createdAt,
});

const repoEvent = (e: {
  id?: string;
  kind: string;
  visibility: string;
  payload: unknown;
}): RepoEventInput => ({
  id: e.id,
  kind: e.kind,
  visibility: e.visibility,
  payload: e.payload as RepoEventInput["payload"],
});

export function createDbReviewStore(repo: ReviewRepository): ReviewStore {
  return {
    backend: "postgres",

    async getReview(id) {
      const row = await repo.getReview(id);
      return row ? toRecord(row) : null;
    },

    async findByIdempotency(idempotencyKey, dedupeScope) {
      const row = await repo.findByIdempotency(idempotencyKey, dedupeScope);
      return row ? toRecord(row) : null;
    },

    async listReviews(opts) {
      const rows = await repo.listReviews({
        status: opts?.status,
        reviewType: opts?.reviewType,
        assignee: opts?.assignee,
        limit: opts?.limit,
        offset: opts?.offset,
      });
      return rows.map(toRecord);
    },

    async submitReview(input, evidence, events) {
      const rows: RepoEvidenceInsert[] = evidence.map((e) => ({
        id: e.id,
        reviewId: e.reviewId,
        type: e.type,
        uri: e.uri,
        label: e.label ?? null,
        description: e.description ?? null,
        submittedBy: e.submittedBy,
      }));
      const { row, duplicate } = await repo.submitReview(
        {
          id: input.id,
          actorResolution: input.actorResolution,
          actorRef: input.actorRef ?? null,
          dedupeScope: input.dedupeScope,
          idempotencyKey: input.idempotencyKey ?? null,
          reviewType: input.reviewType,
          workRef: input.workRef,
          agentCriteria:
            input.agentCriteria === undefined
              ? null
              : (input.agentCriteria as never),
        },
        rows,
        events.map(repoEvent),
      );
      return { record: toRecord(row), duplicate };
    },

    async addEvidence(reviewId, rows, event) {
      const out = await repo.addEvidence(
        reviewId,
        rows.map((e) => ({
          id: e.id,
          reviewId: e.reviewId,
          type: e.type,
          uri: e.uri,
          label: e.label ?? null,
          description: e.description ?? null,
          submittedBy: e.submittedBy,
        })),
        event ? repoEvent(event) : undefined,
      );
      if (!out.ok) return out;
      return { ok: true, added: out.added.map(toEvidence) };
    },

    async listEvidence(reviewId) {
      return (await repo.listEvidence(reviewId)).map(toEvidence);
    },

    async transitionReview(id, input, event): Promise<ReviewTransitionResult> {
      const out = await repo.transitionReview(
        id,
        {
          from: input.from,
          to: input.to,
          actor: input.actor,
          reason: input.reason ?? null,
          declineReason: input.declineReason ?? null,
          now: input.now,
        },
        repoEvent(event),
      );
      if (out.transitioned) {
        return {
          record: toRecord(out.row),
          event: toEvent(out.event),
          transitioned: true,
        };
      }
      return {
        record: out.row ? toRecord(out.row) : null,
        event: null,
        transitioned: false,
        reason: out.reason,
      };
    },

    async decideReview(id, input, event): Promise<ReviewDecideResult> {
      const out = await repo.decideReview(
        id,
        {
          outcome: input.outcome,
          criteriaResults: input.criteriaResults as never,
          summary: input.summary,
          decidedBy: input.decidedBy,
          aiRunRef: input.aiRunRef ?? null,
          now: input.now,
        },
        repoEvent(event),
      );
      if (out.transitioned) {
        return {
          record: toRecord(out.row),
          decision: toDecision(out.decision),
          event: toEvent(out.event),
          transitioned: true,
        };
      }
      return {
        record: out.row ? toRecord(out.row) : null,
        decision: null,
        event: null,
        transitioned: false,
        reason: out.reason,
      };
    },

    async listDecisions(reviewId) {
      return (await repo.listDecisions(reviewId)).map(toDecision);
    },

    async appendEvents(reviewId, events) {
      return (await repo.appendEvents(reviewId, events.map(repoEvent))).map(
        toEvent,
      );
    },

    async listEvents(reviewId, opts) {
      return (
        await repo.listEvents(reviewId, { visibility: opts?.visibility })
      ).map(toEvent);
    },

    async markKnowledgeConverted(id, knowledgeItemId, event, expected) {
      const res = await repo.markKnowledgeConverted(
        id,
        knowledgeItemId,
        repoEvent(event),
        expected,
      );
      return res.marked
        ? { marked: true, record: toRecord(res.record) }
        : res;
    },
  };
}
