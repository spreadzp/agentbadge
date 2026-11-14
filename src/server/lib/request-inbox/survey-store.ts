import type { InboxSurveyAnswer, InboxSurveyRecord } from "./types";

/**
 * EPIC-252 (SLICE-252-1): survey store contract + in-memory impl.
 * Same dedupe rules as the Postgres repo — verified agents dedupe on
 * (surveyId, agentId); anonymous answers on (surveyId, fpHash) with
 * agentId === null (a nullable unique column can't carry that rule).
 */
export interface SurveyStore {
  putSurvey(s: InboxSurveyRecord): Promise<InboxSurveyRecord>;
  getSurvey(id: string): Promise<InboxSurveyRecord | null>;
  listOpenSurveys(nowMs: number, limit?: number): Promise<InboxSurveyRecord[]>;
  setSurveyActive(id: string, active: boolean): Promise<boolean>;
  putAnswer(a: InboxSurveyAnswer): Promise<InboxSurveyAnswer>;
  findAnswerByAgent(surveyId: string, agentId: string): Promise<InboxSurveyAnswer | null>;
  findAnswerByFp(surveyId: string, fpHash: string): Promise<InboxSurveyAnswer | null>;
  listAnswers(surveyId: string, limit?: number): Promise<InboxSurveyAnswer[]>;
  markRated(id: string): Promise<boolean>;
}

/** In-memory implementation — dev/test fallback (D-252-Q4). */
export function createMemorySurveyStore(): SurveyStore {
  const surveys = new Map<string, InboxSurveyRecord>();
  const answers = new Map<string, InboxSurveyAnswer>();

  return {
    async putSurvey(s) {
      const existing = surveys.get(s.id);
      const merged: InboxSurveyRecord = {
        ...s,
        createdAtMs: existing?.createdAtMs ?? s.createdAtMs,
      };
      surveys.set(s.id, merged);
      return { ...merged };
    },

    async getSurvey(id) {
      const s = surveys.get(id);
      return s ? { ...s } : null;
    },

    async listOpenSurveys(nowMs, limit = 50) {
      return [...surveys.values()]
        .filter(
          (s) =>
            s.active && (s.closesAtMs === null || s.closesAtMs > nowMs),
        )
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, limit)
        .map((s) => ({ ...s }));
    },

    async setSurveyActive(id, active) {
      const s = surveys.get(id);
      if (!s) return false;
      s.active = active;
      return true;
    },

    async putAnswer(a) {
      answers.set(a.id, { ...a });
      return { ...a };
    },

    async findAnswerByAgent(surveyId, agentId) {
      for (const a of answers.values()) {
        if (a.surveyId === surveyId && a.agentId === agentId) {
          return { ...a };
        }
      }
      return null;
    },

    async findAnswerByFp(surveyId, fpHash) {
      for (const a of answers.values()) {
        if (
          a.surveyId === surveyId &&
          a.fpHash === fpHash &&
          a.agentId === null
        ) {
          return { ...a };
        }
      }
      return null;
    },

    async listAnswers(surveyId, limit = 500) {
      return [...answers.values()]
        .filter((a) => a.surveyId === surveyId)
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, limit)
        .map((a) => ({ ...a }));
    },

    async markRated(id) {
      const a = answers.get(id);
      if (!a || a.rated) return false;
      a.rated = true;
      return true;
    },
  };
}
