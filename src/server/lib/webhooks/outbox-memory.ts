/**
 * EPIC-233 (SLICE-233-4): in-memory WebhookOutboxStore — dev/test
 * fallback (D-143/D-252-Q4 pattern). Shares the RequestInboxData map
 * so the transition hook and the worker see the same rows.
 */

import type {
  WebhookOutboxRecord,
  WebhookOutboxStore,
} from "./types";

const clone = (r: WebhookOutboxRecord): WebhookOutboxRecord => ({
  ...r,
  payload: { ...r.payload },
});

export const DEFAULT_CLAIM_LEASE_MS = 60_000;

export function createMemoryWebhookOutboxStore(
  rows: Map<string, WebhookOutboxRecord>,
): WebhookOutboxStore {
  const byRequest = new Map<string, string>(); // requestId → rowId

  return {
    async enqueue(rec) {
      const existingId = byRequest.get(rec.requestId);
      if (existingId) {
        const existing = rows.get(existingId);
        if (existing) return clone(existing);
      }
      rows.set(rec.id, { ...rec });
      byRequest.set(rec.requestId, rec.id);
      return clone(rec);
    },

    async claim(nowMs, limit = 25, leaseMs = DEFAULT_CLAIM_LEASE_MS) {
      const due = [...rows.values()]
        .filter(
          (r) =>
            (r.status === "queued" && r.nextAttemptAtMs <= nowMs) ||
            (r.status === "delivering" &&
              (r.lockedAtMs ?? 0) + leaseMs <= nowMs),
        )
        .sort((a, b) => a.nextAttemptAtMs - b.nextAttemptAtMs)
        .slice(0, limit);
      for (const r of due) {
        r.status = "delivering";
        r.attempts += 1;
        r.lockedAtMs = nowMs;
      }
      return due.map(clone);
    },

    async resolve(id, outcome) {
      const r = rows.get(id);
      if (!r) return null;
      r.status = outcome.status;
      r.lockedAtMs = null;
      if (outcome.status === "queued") {
        r.nextAttemptAtMs = outcome.nextAttemptAtMs;
        r.lastError = outcome.lastError;
      } else if (outcome.status === "failed") {
        r.lastError = outcome.lastError;
      } else {
        r.lastError = null;
      }
      return clone(r);
    },

    async get(id) {
      const r = rows.get(id);
      return r ? clone(r) : null;
    },

    async listForRequest(requestId) {
      const id = byRequest.get(requestId);
      const r = id ? rows.get(id) : undefined;
      return r ? [clone(r)] : [];
    },
  };
}
