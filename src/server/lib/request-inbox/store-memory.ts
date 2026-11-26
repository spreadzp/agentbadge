import type { RequestInboxData, RequestStore } from "./store";
import { createMemoryRequestInboxData } from "./store";
import type { InboxQaPair, InboxRequestRecord } from "./types";

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

/** In-memory implementation — dev/test fallback (D-252-Q4). Callers
 *  sharing state with an InteractionStore MUST pass the shared
 *  `RequestInboxData` (singleton via createMemoryRequestInboxStores). */
export function createMemoryRequestStore(
  data?: RequestInboxData,
): RequestStore {
  const d = data ?? createMemoryRequestInboxData();
  const { rows, qaPairs, qaByHash } = d;

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
        callbackUrl: input.callbackUrl ?? null,
        expiresAtMs: input.expiresAtMs,
        createdAtMs: input.createdAtMs ?? Date.now(),
        respondedAtMs: null,
        // EPIC-228 interaction columns — legacy submits stay NULL.
        actorResolution: input.actorResolution ?? null,
        actorRef: input.actorRef ?? null,
        sessionId: input.sessionId ?? null,
        channel: input.channel ?? null,
        intent: null,
        signalType: null,
        outcome: null,
        knowledgeGap: false,
        topics: null,
        entities: null,
        demandSignals: null,
        classifiedBy: null,
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
