import type {
  FeedbackRepository,
  FeedbackEventInput as RepoEventInput,
} from "@agentbadge/database";

import type {
  FeedbackEventInput,
  FeedbackStore,
  FeedbackTransitionResult,
} from "./store";
import type {
  FeedbackEventRecord,
  FeedbackRecord,
} from "./types";

/**
 * EPIC-230 (SLICE-230-1): Postgres adapter — FeedbackRepository rows
 * → FeedbackStore domain records (interaction-store-db.ts precedent).
 * The interface never leaks Models.* types.
 */

type Row = NonNullable<
  Awaited<ReturnType<FeedbackRepository["getFeedback"]>>
>;
type EventRow = Awaited<
  ReturnType<FeedbackRepository["listEvents"]>
>[number];

const toRecord = (r: Row): FeedbackRecord => ({
  id: r.id,
  actorResolution: r.actorResolution,
  actorRef: r.actorRef,
  dedupeScope: r.dedupeScope,
  idempotencyKey: r.idempotencyKey,
  text: r.text,
  kind: r.kind,
  target: r.target,
  severity: r.severity,
  normalized: r.normalized,
  relatedCount: r.relatedCount,
  relatedFeedbackId: r.relatedFeedbackId,
  suggestion: r.suggestion,
  status: r.status,
  knowledgeConverted: r.knowledgeConverted,
  knowledgeItemId: r.knowledgeItemId,
  createdAt: r.createdAt,
  triagedAt: r.triagedAt,
  closedAt: r.closedAt,
  updatedAt: r.updatedAt,
});

const toEvent = (r: EventRow): FeedbackEventRecord => ({
  id: r.id,
  feedbackId: r.feedbackId,
  seq: r.seq,
  kind: r.kind,
  visibility: r.visibility,
  payload: r.payload as unknown,
  createdAt: r.createdAt,
});

const repoEvents = (
  events: FeedbackEventInput[],
): RepoEventInput[] =>
  events.map((e) => ({
    id: e.id,
    kind: e.kind,
    visibility: e.visibility,
    payload: e.payload as RepoEventInput["payload"],
  }));

export function createDbFeedbackStore(
  repo: FeedbackRepository,
): FeedbackStore {
  return {
    backend: "postgres",

    async getFeedback(id) {
      const row = await repo.getFeedback(id);
      return row ? toRecord(row) : null;
    },

    async findByIdempotency(idempotencyKey, dedupeScope) {
      const row = await repo.findByIdempotency(idempotencyKey, dedupeScope);
      return row ? toRecord(row) : null;
    },

    async listFeedback(opts) {
      const rows = await repo.listFeedback({
        status: opts?.status,
        kind: opts?.kind,
        target: opts?.target,
        limit: opts?.limit,
        offset: opts?.offset,
      });
      return rows.map(toRecord);
    },

    async submitFeedback(input, events) {
      const { row, duplicate, relatedTo } = await repo.submitFeedback(
        {
          id: input.id,
          actorResolution: input.actorResolution,
          actorRef: input.actorRef ?? null,
          dedupeScope: input.dedupeScope,
          idempotencyKey: input.idempotencyKey ?? null,
          text: input.text,
          kind: input.kind ?? null,
          target: input.target ?? null,
          severity: input.severity ?? null,
          normalized: input.normalized,
        },
        repoEvents(events),
      );
      return { record: toRecord(row), duplicate, relatedTo };
    },

    async transitionFeedback(id, input, event): Promise<FeedbackTransitionResult> {
      const out = await repo.transitionFeedback(
        id,
        {
          from: input.from,
          to: input.to,
          actor: input.actor,
          reason: input.reason ?? null,
          patch: input.patch
            ? {
                kind: input.patch.kind,
                target: input.patch.target,
                severity: input.patch.severity,
                suggestion: input.patch.suggestion,
              }
            : undefined,
          now: input.now,
        },
        {
          id: event.id,
          kind: event.kind,
          visibility: event.visibility,
          payload: event.payload as RepoEventInput["payload"],
        },
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

    async appendEvents(feedbackId, events) {
      const rows = await repo.appendEvents(feedbackId, repoEvents(events));
      return rows.map(toEvent);
    },

    async listEvents(feedbackId, opts) {
      const rows = await repo.listEvents(feedbackId, {
        visibility: opts?.visibility,
      });
      return rows.map(toEvent);
    },

    async markKnowledgeConverted(id, knowledgeItemId, event, expected) {
      const res = await repo.markKnowledgeConverted(
        id,
        knowledgeItemId,
        {
          id: event.id,
          kind: event.kind,
          visibility: event.visibility,
          payload: event.payload as RepoEventInput["payload"],
        },
        expected,
      );
      return res.marked
        ? { marked: true, record: toRecord(res.record) }
        : res;
    },
  };
}
