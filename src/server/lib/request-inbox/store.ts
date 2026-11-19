import type { SurveyStore } from "./survey-store";
import type {
  InboxQaPair,
  InboxRequestRecord,
} from "./types";

/**
 * EPIC-252 (SLICE-252-1): dual-mode request inbox store.
 *
 * Same contract as the Postgres adapter (`store-db.ts`) — routes only
 * ever see this interface (D-252-Q4: DATABASE_ENABLED flips the backend,
 * behavior stays identical).
 *
 * Semantics the implementations MUST share:
 * - `submit` is the dedupe point: when `idempotencyKey` is set and a row
 *   with (key, fpHash) exists, the EXISTING record is returned — never a
 *   second row. Without a key every submit is a new record.
 * - `transition` is conditional on the expected `from` state (stale
 *   responder races resolve as null, not as clobbered state).
 * - Expiry is enforced lazily by `get` returning `{expired: true}` —
 *   hard deletion is the janitor's job.
 */

export interface SubmitInput {
  id: string;
  state: string;
  kind?: string | null;
  payload?: unknown;
  fingerprint: InboxRequestRecord["fingerprint"];
  fpHash: string;
  agentId?: string | null;
  verified?: boolean;
  /** D-256-Q13: opt-in consent to publish into the QA corpus
   *  (default false — privacy-safe). */
  publishToQa?: boolean;
  idempotencyKey?: string | null;
  expiresAtMs: number;
  createdAtMs?: number;
}

export interface RequestStore {
  submit(input: SubmitInput): Promise<{ record: InboxRequestRecord; duplicate: boolean }>;
  get(id: string): Promise<{ record: InboxRequestRecord | null; expired: boolean }>;
  listByState(opts?: { state?: string; sinceMs?: number; limit?: number }): Promise<InboxRequestRecord[]>;
  transition(id: string, from: string, to: string, patch?: {
    response?: unknown;
    respondedAtMs?: number | null;
    spamFlag?: boolean;
  }): Promise<InboxRequestRecord | null>;
  /** D-252-Q5 dedupe probe — replay check runs BEFORE the 252-2
   *  submit rate-limit so a retried POST bypasses the limit. */
  findByIdempotency(
    idempotencyKey: string,
    fpHash: string,
  ): Promise<InboxRequestRecord | null>;
  setSpamFlag(id: string, spamFlag: boolean): Promise<boolean>;
  /** QA corpus materialization (D-252-Q7) — same questionHash bumps uses. */
  upsertQaPair(qa: Omit<InboxQaPair, "uses"> & { uses?: number }): Promise<InboxQaPair>;
  /** D-256-Q14: soft retract — record + reason kept for audit.
   *  Idempotent: repeat calls return the stored pair unchanged.
   *  Null when no such pair exists. */
  retractQaPair(
    id: string,
    reason: string,
    retractedAtMs?: number,
  ): Promise<InboxQaPair | null>;
  /** Excludes retracted pairs (D-256-Q14 — also the fast-path gate). */
  getQaByHash(questionHash: string): Promise<InboxQaPair | null>;
  /** SLICE-256-9 (review R-2): retracted INCLUDED — the janitor
   *  re-materialization leg must distinguish "no pair ever" from
   *  "pair retracted" (the latter must not resurrect). */
  getQaByHashIncludingRetracted(
    questionHash: string,
  ): Promise<InboxQaPair | null>;
  /** Excludes retracted pairs (D-256-Q14). */
  searchQa(substring: string, limit?: number): Promise<InboxQaPair[]>;
  // janitor legs
  listExpired(nowMs: number, limit?: number): Promise<InboxRequestRecord[]>;
  listPurgeable(cutoffMs: number, limit?: number): Promise<InboxRequestRecord[]>;
  purgePayload(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export interface RequestInboxStores {
  requests: RequestStore;
  surveys: SurveyStore;
  /** "postgres" | "memory" — janitor logs the active backend. */
  backend: string;
}

const TERMINAL = new Set(["completed", "failed"]);

function cloneRecord(r: InboxRequestRecord): InboxRequestRecord {
  return {
    ...r,
    fingerprint: {
      ...r.fingerprint,
      headers: { ...r.fingerprint.headers },
    },
  };
}

/** In-memory implementation — dev/test fallback (D-252-Q4). */
export function createMemoryRequestStore(): RequestStore {
  const rows = new Map<string, InboxRequestRecord>();
  const qaPairs = new Map<string, InboxQaPair>();
  const qaByHash = new Map<string, string>();

  return {
    async submit(input) {
      if (input.idempotencyKey) {
        for (const r of rows.values()) {
          if (
            r.idempotencyKey === input.idempotencyKey &&
            r.fpHash === input.fpHash
          ) {
            return { record: cloneRecord(r), duplicate: true };
          }
        }
      }
      const record: InboxRequestRecord = {
        id: input.id,
        state: input.state,
        kind: input.kind ?? null,
        payload: input.payload ?? null,
        fingerprint: input.fingerprint,
        fpHash: input.fpHash,
        agentId: input.agentId ?? null,
        verified: input.verified ?? false,
        response: null,
        spamFlag: false,
        publishToQa: input.publishToQa ?? false,
        idempotencyKey: input.idempotencyKey ?? null,
        expiresAtMs: input.expiresAtMs,
        createdAtMs: input.createdAtMs ?? Date.now(),
        respondedAtMs: null,
      };
      rows.set(record.id, record);
      return { record: cloneRecord(record), duplicate: false };
    },

    async findByIdempotency(idempotencyKey, fpHash) {
      for (const r of rows.values()) {
        if (
          r.idempotencyKey === idempotencyKey &&
          r.fpHash === fpHash
        ) {
          return cloneRecord(r);
        }
      }
      return null;
    },

    async get(id) {
      const r = rows.get(id);
      if (!r) return { record: null, expired: false };
      return {
        record: cloneRecord(r),
        expired: r.expiresAtMs < Date.now(),
      };
    },

    async listByState(opts) {
      let out = [...rows.values()];
      if (opts?.state !== undefined) {
        out = out.filter((r) => r.state === opts.state);
      }
      if (opts?.sinceMs !== undefined) {
        out = out.filter((r) => r.createdAtMs >= opts.sinceMs!);
      }
      out.sort((a, b) => b.createdAtMs - a.createdAtMs);
      return out.slice(0, opts?.limit ?? 500).map(cloneRecord);
    },

    async transition(id, from, to, patch) {
      const r = rows.get(id);
      if (!r || r.state !== from) return null;
      r.state = to;
      if (patch?.response !== undefined) r.response = patch.response;
      if (patch?.respondedAtMs !== undefined)
        r.respondedAtMs = patch.respondedAtMs;
      if (patch?.spamFlag !== undefined) r.spamFlag = patch.spamFlag;
      return cloneRecord(r);
    },

    async setSpamFlag(id, spamFlag) {
      const r = rows.get(id);
      if (!r) return false;
      r.spamFlag = spamFlag;
      return true;
    },

    async upsertQaPair(qa) {
      const existingId = qaByHash.get(qa.questionHash);
      if (existingId) {
        const existing = qaPairs.get(existingId)!;
        existing.uses += 1;
        // Re-audit N-5: a later upsert with a real response replaces
        // a null/stale one, not just bumps the counter.
        if (qa.response != null) existing.response = qa.response;
        return { ...existing };
      }
      const pair: InboxQaPair = { ...qa, uses: qa.uses ?? 0 };
      qaPairs.set(pair.id, pair);
      qaByHash.set(pair.questionHash, pair.id);
      return { ...pair };
    },

    async retractQaPair(id, reason, retractedAtMs) {
      const pair = qaPairs.get(id);
      if (!pair) return null;
      // Idempotent — a repeat retract returns the stored pair, the
      // first reason/timestamp wins (audit is append-only).
      if (pair.retractedAtMs != null) return { ...pair };
      pair.retractedAtMs = retractedAtMs ?? Date.now();
      pair.retractReason = reason;
      return { ...pair };
    },

    async getQaByHash(questionHash) {
      const id = qaByHash.get(questionHash);
      const pair = id ? qaPairs.get(id) : undefined;
      // D-256-Q14: retracted pairs are invisible to the fast-path.
      return pair && pair.retractedAtMs == null ? { ...pair } : null;
    },

    async getQaByHashIncludingRetracted(questionHash) {
      const id = qaByHash.get(questionHash);
      const pair = id ? qaPairs.get(id) : undefined;
      return pair ? { ...pair } : null;
    },

    async searchQa(substring, limit = 50) {
      const needle = substring.toLowerCase();
      return [...qaPairs.values()]
        .filter(
          (p) =>
            p.retractedAtMs == null &&
            p.question.toLowerCase().includes(needle),
        )
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, limit)
        .map((p) => ({ ...p }));
    },

    async listExpired(nowMs, limit = 500) {
      return [...rows.values()]
        .filter((r) => r.expiresAtMs < nowMs)
        .sort((a, b) => a.expiresAtMs - b.expiresAtMs)
        .slice(0, limit)
        .map(cloneRecord);
    },

    async listPurgeable(cutoffMs, limit = 500) {
      return [...rows.values()]
        .filter(
          (r) =>
            TERMINAL.has(r.state) &&
            r.payload !== null &&
            r.createdAtMs < cutoffMs,
        )
        .sort((a, b) => a.createdAtMs - b.createdAtMs)
        .slice(0, limit)
        .map(cloneRecord);
    },

    async purgePayload(id) {
      const r = rows.get(id);
      if (!r) return false;
      r.payload = null;
      return true;
    },

    async delete(id) {
      return rows.delete(id);
    },
  };
}
