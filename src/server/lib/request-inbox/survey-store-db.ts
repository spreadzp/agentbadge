import type {
  AgentSurveyRepository,
  AgentSurveyUpsert,
  SurveyAnswerUpsert,
} from "@agentbadge/database";

import {
  SurveyAnswerDuplicateError,
  type SurveyStore,
} from "./survey-store";
import type { InboxSurveyAnswer, InboxSurveyRecord } from "./types";

/** EPIC-252 (SLICE-252-1): Postgres adapter — survey facet.
 *  Split from store-db.ts for the file-size guard (SLICE-233-3). */

type SRepo = AgentSurveyRepository;
type SurveyRow = NonNullable<Awaited<ReturnType<SRepo["getSurvey"]>>>;
type AnswerRow = NonNullable<Awaited<ReturnType<SRepo["getAnswer"]>>>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null =>
  v == null ? null : Number(v);
const json = (v: unknown): unknown => v;

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
  softFpHash: r.softFpHash,
  answers: json(r.answers),
  rated: r.rated,
  flag: r.flag,
  createdAtMs: num(r.createdAtMs),
});

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
      try {
        return toAnswer(await repo.putAnswer(upsert));
      } catch (err) {
        // Re-audit H-5: only a real unique-violation maps to 409 —
        // Prisma P2002 or SQLSTATE 23505. A message-substring match
        // also caught FK errors (…_surveyId_fkey) as false dups.
        const code = (err as { code?: string } | null)?.code;
        if (code === "P2002" || code === "23505") {
          throw new SurveyAnswerDuplicateError();
        }
        throw err;
      }
    },

    async findAnswerByAgent(surveyId, agentId) {
      const row = await repo.findAnswerByAgent(surveyId, agentId);
      return row ? toAnswer(row) : null;
    },

    async findAnswerByFp(surveyId, fpHash) {
      const row = await repo.findAnswerByFp(surveyId, fpHash);
      return row ? toAnswer(row) : null;
    },

    async findAnswerBySoftFp(surveyId, softFpHash) {
      const row = await repo.findAnswerBySoftFp(surveyId, softFpHash);
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
