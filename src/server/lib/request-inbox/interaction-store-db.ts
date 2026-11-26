import type {
  InteractionRepository,
  InteractionSubmit,
  InteractionEventInput as RepoEventInput,
  InteractionClassifyPatch as RepoClassifyPatch,
  InteractionResponseInsert as RepoResponseInsert,
} from "@agentbadge/database";

import type {
  InteractionEventInput,
  InteractionStore,
} from "./interaction-store";
import type {
  InteractionEventRecord,
  InteractionResponseRecord,
  InteractionSessionRecord,
} from "./interaction-types";
import { STATUS_TO_STATE } from "./interaction-types";
import { toRequest, CALLBACK_URL_FP_KEY } from "./store-db";

/**
 * EPIC-228 (SLICE-228-1): Postgres adapter — InteractionRepository
 * rows → InteractionStore domain records (store-db.ts precedent).
 * Codec boundary: sessions/responses/events are mapped here so the
 * interface never leaks Models.* types.
 */

// Row types derive from the repository signatures — the emitted
// `Models` namespace is not part of the package's public surface.
type SessionRow = NonNullable<
  Awaited<ReturnType<InteractionRepository["getSession"]>>
>;
type ResponseRow = Awaited<
  ReturnType<InteractionRepository["listResponses"]>
>[number];
type EventRow = Awaited<
  ReturnType<InteractionRepository["listEvents"]>
>[number];

const num = (v: unknown): number => Number(v);

const toSession = (r: SessionRow): InteractionSessionRecord => ({
  id: r.id,
  actorRef: r.actorRef,
  firstSeenAtMs: num(r.firstSeenAtMs),
  lastSeenAtMs: num(r.lastSeenAtMs),
  requestCount: r.requestCount,
  createdAtMs: Date.parse(r.createdAt),
});

const toResponse = (r: ResponseRow): InteractionResponseRecord => ({
  id: r.id,
  requestId: r.requestId,
  operatorRef: r.operatorRef,
  body: r.body,
  createdAtMs: num(r.createdAtMs),
});

const toEvent = (r: EventRow): InteractionEventRecord => ({
  id: r.id,
  requestId: r.requestId,
  seq: r.seq,
  kind: r.kind,
  visibility: r.visibility,
  payload: r.payload as unknown,
  createdAtMs: num(r.createdAtMs),
});

const repoEvents = (
  events: InteractionEventInput[],
): RepoEventInput[] =>
  events.map((e) => ({
    id: e.id,
    kind: e.kind,
    visibility: e.visibility,
    payload: e.payload as RepoEventInput["payload"],
    createdAtMs: e.createdAtMs,
  }));

export function createDbInteractionStore(
  repo: InteractionRepository,
): InteractionStore {
  return {
    async submitInteraction(input, events) {
      const submit: InteractionSubmit = {
        id: input.id,
        state: input.state,
        kind: input.kind ?? null,
        payload: input.payload as InteractionSubmit["payload"],
        fingerprint: {
          ...input.fingerprint,
          ...(input.callbackUrl != null
            ? { [CALLBACK_URL_FP_KEY]: input.callbackUrl }
            : {}),
        } as unknown as InteractionSubmit["fingerprint"],
        fpHash: input.fpHash,
        agentId: input.agentId ?? null,
        verified: input.verified ?? false,
        publishToQa: input.publishToQa ?? false,
        idempotencyKey: input.idempotencyKey ?? null,
        expiresAtMs: input.expiresAtMs,
        createdAtMs: input.createdAtMs ?? Date.now(),
        actorResolution: input.actorResolution,
        actorRef: input.actorRef ?? null,
        sessionId: input.sessionId ?? null,
        channel: input.channel,
      };
      const { row, duplicate } = await repo.submitInteraction(
        submit,
        repoEvents(events),
      );
      const session = input.sessionId
        ? await repo.getSession(input.sessionId)
        : null;
      return {
        record: toRequest(row),
        duplicate,
        session: session ? toSession(session) : null,
      };
    },

    async classify(id, patch, events, nowMs) {
      const repoPatch: RepoClassifyPatch = {
        intent: patch.intent,
        signalType: patch.signalType,
        outcome: patch.outcome,
        knowledgeGap: patch.knowledgeGap,
        topics: patch.topics as RepoClassifyPatch["topics"],
        entities: patch.entities as RepoClassifyPatch["entities"],
        demandSignals:
          patch.demandSignals as RepoClassifyPatch["demandSignals"],
        classifiedBy: patch.classifiedBy,
      };
      const out = await repo.classify(
        id,
        repoPatch,
        repoEvents(events),
        nowMs ?? Date.now(),
      );
      return out
        ? { record: toRequest(out.row), transitioned: out.transitioned }
        : null;
    },

    async respond(id, response, events, nowMs) {
      const t = nowMs ?? Date.now();
      const insert: RepoResponseInsert = {
        id: response.id,
        requestId: response.requestId,
        operatorRef: response.operatorRef,
        body: response.body,
        createdAtMs: response.createdAtMs ?? t,
      };
      const out = await repo.respond(id, insert, repoEvents(events), t);
      return {
        record: out.row ? toRequest(out.row) : null,
        transitioned: out.transitioned,
      };
    },

    async reject(id, events, nowMs) {
      const out = await repo.reject(
        id,
        repoEvents(events),
        nowMs ?? Date.now(),
      );
      return {
        record: out.row ? toRequest(out.row) : null,
        transitioned: out.transitioned,
      };
    },

    async listQueue(opts) {
      const rows = await repo.listQueue({
        state: opts?.status ? STATUS_TO_STATE[opts.status] : undefined,
        actorResolution: opts?.actorResolution,
        limit: opts?.limit,
        beforeMs: opts?.beforeMs,
      });
      return rows.map(toRequest);
    },

    async listBySession(sessionId, limit = 100) {
      return (await repo.listBySession(sessionId, limit)).map(toRequest);
    },

    async getSession(id) {
      const row = await repo.getSession(id);
      return row ? toSession(row) : null;
    },

    async upsertSession(input) {
      const out = await repo.upsertSession(input);
      return { session: toSession(out.session), created: out.created };
    },

    async appendEvents(requestId, events, nowMs) {
      const rows = await repo.appendEvents(
        requestId,
        repoEvents(events),
        nowMs ?? Date.now(),
      );
      return rows.map(toEvent);
    },

    async listEvents(requestId, opts) {
      return (
        await repo.listEvents(requestId, { visibility: opts?.visibility })
      ).map(toEvent);
    },

    async listResponses(requestId) {
      return (await repo.listResponses(requestId)).map(toResponse);
    },
  };
}
