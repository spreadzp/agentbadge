import type {
  AgentQAPairUpsert,
  AgentRequestRepository,
  AgentRequestUpsert,
  AgentSurveyRepository,
  AgentSurveyUpsert,
  SurveyAnswerUpsert,
} from "@agentbadge/database";

import type { SurveyStore } from "./survey-store";
import type {
  SubmitInput,
  RequestStore,
  RequestInboxStores,
} from "./store";
import type {
  InboxFingerprint,
  InboxQaPair,
  InboxRequestRecord,
  InboxSurveyAnswer,
  InboxSurveyRecord,
} from "./types";

/**
 * EPIC-252 (SLICE-252-1): Postgres-backed RequestInboxStores adapter.
 * Thin mapper — every method delegates to the repository and converts
 * codec rows (BigInt int8 columns) into plain domain records.
 */

// Row types are derived from the repository signatures — the emitted
// `Models` namespace is not part of the package's public surface.
type ReqRow = NonNullable<
  Awaited<ReturnType<AgentRequestRepository["get"]>>
>;
type QaRow = NonNullable<
  Awaited<ReturnType<AgentRequestRepository["getQaByHash"]>>
>;
type SurveyRow = NonNullable<
  Awaited<ReturnType<AgentSurveyRepository["getSurvey"]>>
>;
type AnswerRow = NonNullable<
  Awaited<ReturnType<AgentSurveyRepository["getAnswer"]>>
>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null =>
  v == null ? null : Number(v);
const json = (v: unknown): unknown => v;

const toRequest = (r: ReqRow): InboxRequestRecord => ({
  id: r.id,
  state: r.state,
  kind: r.kind,
  payload: json(r.payload),
  fingerprint: r.fingerprint as unknown as InboxFingerprint,
  fpHash: r.fpHash,
  agentId: r.agentId,
  verified: r.verified,
  response: json(r.response),
  spamFlag: r.spamFlag,
  idempotencyKey: r.idempotencyKey,
  expiresAtMs: num(r.expiresAtMs),
  createdAtMs: num(r.createdAtMs),
  respondedAtMs: numOrNull(r.respondedAtMs),
});

const toQa = (r: QaRow): InboxQaPair => ({
  id: r.id,
  questionHash: r.questionHash,
  question: r.question,
  response: json(r.response),
  sourceRequestId: r.sourceRequestId,
  uses: r.uses,
  createdAtMs: num(r.createdAtMs),
});

const toSurvey = (r: SurveyRow): InboxSurveyRecord => ({
  id: r.id,
  title: r.title,
  questions: json(r.questions),
  active: r.active,
  closesAtMs: numOrNull(r.closesAtMs),
  createdAtMs: num(r.createdAtMs),
});

const toAnswer = (r: AnswerRow): InboxSurveyAnswer => ({
  id: r.id,
  surveyId: r.surveyId,
  agentId: r.agentId,
  fpHash: r.fpHash,
  answers: json(r.answers),
  rated: r.rated,
  createdAtMs: num(r.createdAtMs),
});

export function createDbRequestStore(
  repo: AgentRequestRepository,
): RequestStore {
  return {
    async submit(input) {
      if (input.idempotencyKey) {
        const existing = await repo.findByIdempotency(
          input.idempotencyKey,
          input.fpHash,
        );
        if (existing) {
          return { record: toRequest(existing), duplicate: true };
        }
      }
      const upsert: AgentRequestUpsert = {
        id: input.id,
        state: input.state,
        kind: input.kind ?? null,
        payload: (input.payload ?? null) as AgentRequestUpsert["payload"],
        fingerprint:
          input.fingerprint as unknown as AgentRequestUpsert["fingerprint"],
        fpHash: input.fpHash,
        agentId: input.agentId ?? null,
        verified: input.verified ?? false,
        idempotencyKey: input.idempotencyKey ?? null,
        expiresAtMs: input.expiresAtMs,
        createdAtMs: input.createdAtMs ?? Date.now(),
      };
      const row = await repo.put(upsert);
      return { record: toRequest(row), duplicate: false };
    },

    async get(id) {
      const row = await repo.get(id);
      if (!row) return { record: null, expired: false };
      const record = toRequest(row);
      return { record, expired: record.expiresAtMs < Date.now() };
    },

    async listByState(opts) {
      const rows = await repo.listByState({
        state: opts?.state,
        sinceMs: opts?.sinceMs,
        limit: opts?.limit,
      });
      return rows.map(toRequest);
    },

    async transition(id, from, to, patch) {
      const row = await repo.transition(id, from, to, {
        response: patch?.response as never,
        respondedAtMs: patch?.respondedAtMs,
        spamFlag: patch?.spamFlag,
      });
      return row ? toRequest(row) : null;
    },

    async setSpamFlag(id, spamFlag) {
      return (await repo.setSpamFlag(id, spamFlag)) !== null;
    },

    async upsertQaPair(qa) {
      const upsert: AgentQAPairUpsert = {
        id: qa.id,
        questionHash: qa.questionHash,
        question: qa.question,
        response: qa.response as AgentQAPairUpsert["response"],
        sourceRequestId: qa.sourceRequestId,
        createdAtMs: qa.createdAtMs,
      };
      return toQa(await repo.upsertQaPair(upsert));
    },

    async getQaByHash(questionHash) {
      const row = await repo.getQaByHash(questionHash);
      return row ? toQa(row) : null;
    },

    async searchQa(substring, limit = 50) {
      return (await repo.searchQa(substring, limit)).map(toQa);
    },

    async listExpired(nowMs, limit = 500) {
      return (await repo.listExpired(nowMs, limit)).map(toRequest);
    },

    async listPurgeable(cutoffMs, limit = 500) {
      return (await repo.listPurgeable(cutoffMs, limit)).map(toRequest);
    },

    async purgePayload(id) {
      return repo.purgePayload(id);
    },

    async delete(id) {
      return repo.delete(id);
    },
  };
}

export function createDbSurveyStore(repo: AgentSurveyRepository): SurveyStore {
  return {
    async putSurvey(s) {
      const upsert: AgentSurveyUpsert = {
        id: s.id,
        title: s.title,
        questions: s.questions as AgentSurveyUpsert["questions"],
        active: s.active,
        closesAtMs: s.closesAtMs,
        createdAtMs: s.createdAtMs,
      };
      return toSurvey(await repo.putSurvey(upsert));
    },

    async getSurvey(id) {
      const row = await repo.getSurvey(id);
      return row ? toSurvey(row) : null;
    },

    async listOpenSurveys(nowMs, limit = 50) {
      return (await repo.listOpenSurveys(nowMs, limit)).map(toSurvey);
    },

    async setSurveyActive(id, active) {
      return (await repo.setSurveyActive(id, active)) !== null;
    },

    async putAnswer(a) {
      const upsert: SurveyAnswerUpsert = {
        id: a.id,
        surveyId: a.surveyId,
        agentId: a.agentId,
        fpHash: a.fpHash,
        answers: a.answers as SurveyAnswerUpsert["answers"],
        rated: a.rated,
        createdAtMs: a.createdAtMs,
      };
      return toAnswer(await repo.putAnswer(upsert));
    },

    async findAnswerByAgent(surveyId, agentId) {
      const row = await repo.findAnswerByAgent(surveyId, agentId);
      return row ? toAnswer(row) : null;
    },

    async findAnswerByFp(surveyId, fpHash) {
      const row = await repo.findAnswerByFp(surveyId, fpHash);
      return row ? toAnswer(row) : null;
    },

    async listAnswers(surveyId, limit = 500) {
      return (await repo.listAnswers(surveyId, limit)).map(toAnswer);
    },

    async markRated(id) {
      return repo.markRated(id);
    },
  };
}

export function createDbRequestInboxStores(
  requests: AgentRequestRepository,
  surveys: AgentSurveyRepository,
): RequestInboxStores {
  return {
    requests: createDbRequestStore(requests),
    surveys: createDbSurveyStore(surveys),
    backend: "postgres",
  };
}

/** SubmitInput re-export kept for route ergonomics. */
export type { SubmitInput };
