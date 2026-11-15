import type { InboxSurveyAnswer, InboxSurveyRecord } from "./types";

/**
 * EPIC-252 (SLICE-252-1): survey store contract + in-memory impl.
 * Same dedupe rules as the Postgres repo — verified agents dedupe on
 * (surveyId, agentId); anonymous answers on (surveyId, fpHash) with
 * agentId === null (a nullable unique column can't carry that rule).
 */
/** Thrown by putAnswer when the (surveyId, agentId|fpHash) pair is
 *  already claimed — routes map this to 409 (audit H-5). */
export class SurveyAnswerDuplicateError extends Error {
  constructor() {
    super("survey answer already exists for this identity");
    this.name = "SurveyAnswerDuplicateError";
  }
}

export interface SurveyStore {
  putSurvey(s: InboxSurveyRecord): Promise<InboxSurveyRecord>;
  getSurvey(id: string): Promise<InboxSurveyRecord | null>;
  listOpenSurveys(nowMs: number, limit?: number): Promise<InboxSurveyRecord[]>;
  setSurveyActive(id: string, active: boolean): Promise<boolean>;
  /** Atomic claim — throws SurveyAnswerDuplicateError on a dup. */
  putAnswer(a: InboxSurveyAnswer): Promise<InboxSurveyAnswer>;
  findAnswerByAgent(surveyId: string, agentId: string): Promise<InboxSurveyAnswer | null>;
  findAnswerByFp(surveyId: string, fpHash: string): Promise<InboxSurveyAnswer | null>;
  /** Rotation guard: match on the IP-less soft fingerprint — callers
   *  with a stable UA+headers identity who hop IPs. A hit does NOT
   *  throw; the route accepts the answer with flag="soft_fp_dup". */
  findAnswerBySoftFp(surveyId: string, softFpHash: string): Promise<InboxSurveyAnswer | null>;
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
      // Audit H-5: claim atomically — the dedupe check lives inside
      // the write so concurrent answers can't both pass find-then-set.
      for (const x of answers.values()) {
        const dup =
          x.surveyId === a.surveyId &&
          (a.agentId !== null
            ? x.agentId === a.agentId
            : x.agentId === null && x.fpHash === a.fpHash);
        if (dup) throw new SurveyAnswerDuplicateError();
      }
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

    async findAnswerBySoftFp(surveyId, softFpHash) {
      if (softFpHash == null) return null;
      for (const a of answers.values()) {
        if (
          a.surveyId === surveyId &&
          a.softFpHash === softFpHash
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
