import type {
  FeedbackEventRecord,
  FeedbackRecord,
} from "./types";
import { FEEDBACK_TRANSITIONS } from "./types";
import type {
  FeedbackEventInput,
  FeedbackStore,
} from "./store";

/**
 * EPIC-230 (SLICE-230-1, D-229-1/D-143): in-memory feedback store —
 * behavioral parity with the Postgres adapter (same status machine,
 * same dedup rules, same append-only events).
 *
 * "Atomic" = synchronous body inside the async method: a refusal
 * writes NOTHING, exactly like a rolled-back tx.
 */

export interface FeedbackMemoryData {
  rows: Map<string, FeedbackRecord>;
  events: Map<string, FeedbackEventRecord[]>;
}

export function createMemoryFeedbackData(): FeedbackMemoryData {
  return { rows: new Map(), events: new Map() };
}

const clone = (r: FeedbackRecord): FeedbackRecord => ({ ...r });
const cloneEvent = (e: FeedbackEventRecord): FeedbackEventRecord => ({
  ...e,
});

/** Arc 230-8 M14: an unauthenticated caller must not be able to make
 *  every submit an O(store) scan. Idempotency and normalized probes
 *  go through secondary indexes; list* stays a scan (admin-side). */
const idemKey = (scope: string, key: string) => `${scope}\u0000${key}`;

export function createMemoryFeedbackStore(
  data: FeedbackMemoryData,
): FeedbackStore {
  const { rows, events } = data;
  const byIdem = new Map<string, FeedbackRecord>();
  const byNormalized = new Map<string, FeedbackRecord[]>();
  const now = () => new Date().toISOString();

  const appendEventsMem = (
    feedbackId: string,
    evts: FeedbackEventInput[],
  ): FeedbackEventRecord[] => {
    if (evts.length === 0) return [];
    const log = events.get(feedbackId) ?? [];
    let seq = log.reduce((m, e) => Math.max(m, e.seq), 0);
    const out: FeedbackEventRecord[] = [];
    for (const e of evts) {
      seq += 1;
      const rec: FeedbackEventRecord = {
        id: e.id ?? crypto.randomUUID(),
        feedbackId,
        seq,
        kind: e.kind,
        visibility: e.visibility,
        payload: e.payload,
        createdAt: now(),
      };
      log.push(rec);
      out.push(cloneEvent(rec));
    }
    events.set(feedbackId, log);
    return out;
  };

  return {
    backend: "memory",

    async getFeedback(id) {
      const r = rows.get(id);
      return r ? clone(r) : null;
    },

    async findByIdempotency(idempotencyKey, dedupeScope) {
      const hit = byIdem.get(idemKey(dedupeScope, idempotencyKey));
      return hit ? clone(hit) : null;
    },

    async listFeedback(opts) {
      let out = [...rows.values()];
      if (opts?.status !== undefined) {
        out = out.filter((r) => r.status === opts.status);
      }
      if (opts?.kind !== undefined) {
        out = out.filter((r) => r.kind === opts.kind);
      }
      if (opts?.target !== undefined) {
        out = out.filter((r) => r.target === opts.target);
      }
      out.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : 1),
      );
      const offset = Math.max(0, opts?.offset ?? 0);
      // Arc 230-8 nit: store-side limit ceiling (repo parity: ≤1000).
      const limit = Math.min(opts?.limit ?? 100, 1000);
      return out
        .slice(offset, offset + limit)
        .map(clone);
    },

    async submitFeedback(input, evts) {
      if (input.idempotencyKey) {
        const existing = await this.findByIdempotency(
          input.idempotencyKey,
          input.dedupeScope,
        );
        if (existing) return { record: existing, duplicate: true, relatedTo: null };
      }
      // Auto-dedup link — earliest OPEN canonical sharing the
      // normalized key (same rule as the repo's FOR UPDATE probe).
      // M14: scan only this key's bucket, not the whole store.
      let canonical: FeedbackRecord | null = null;
      for (const r of byNormalized.get(input.normalized) ?? []) {
        if (
          r.normalized === input.normalized &&
          r.relatedFeedbackId === null &&
          r.status !== "CLOSED" &&
          (canonical === null ||
            r.createdAt.localeCompare(canonical.createdAt) < 0 ||
            (r.createdAt === canonical.createdAt && r.id < canonical.id))
        ) {
          canonical = r;
        }
      }
      const t = now();
      const record: FeedbackRecord = {
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
        relatedCount: 1,
        relatedFeedbackId: canonical?.id ?? null,
        suggestion: null,
        status: "RECEIVED",
        knowledgeConverted: false,
        knowledgeItemId: null,
        createdAt: t,
        triagedAt: null,
        closedAt: null,
        updatedAt: t,
      };
      rows.set(record.id, record);
      if (record.idempotencyKey !== null) {
        byIdem.set(idemKey(record.dedupeScope, record.idempotencyKey), record);
      }
      const bucket = byNormalized.get(record.normalized) ?? [];
      bucket.push(record);
      byNormalized.set(record.normalized, bucket);
      if (canonical) {
        canonical.relatedCount += 1;
        // Arc 230-8 M4: no updatedAt bump — the canonical row's owner
        // would otherwise see other tenants' dedupe hits via the
        // public projection.
      }
      appendEventsMem(record.id, evts);
      return {
        record: clone(record),
        duplicate: false,
        relatedTo: canonical?.id ?? null,
      };
    },

    async transitionFeedback(id, input, event) {
      const cur = rows.get(id);
      if (!cur) {
        return { record: null, event: null, transitioned: false, reason: "missing" };
      }
      if (cur.status !== input.from) {
        return { record: clone(cur), event: null, transitioned: false, reason: "status_mismatch" };
      }
      const legal = FEEDBACK_TRANSITIONS[
        input.from as keyof typeof FEEDBACK_TRANSITIONS
      ]?.has(input.to as never);
      if (legal !== true) {
        return { record: clone(cur), event: null, transitioned: false, reason: "illegal" };
      }
      const t = input.now ?? now();
      cur.status = input.to;
      cur.updatedAt = t;
      // Effects derive from `to` — never caller-set.
      if (input.to === "TRIAGED") cur.triagedAt = t;
      if (input.to === "CLOSED") cur.closedAt = t;
      const p = input.patch ?? {};
      if (p.kind !== undefined) cur.kind = p.kind;
      if (p.target !== undefined) cur.target = p.target;
      if (p.severity !== undefined) cur.severity = p.severity;
      if (p.suggestion !== undefined) cur.suggestion = p.suggestion;
      const appended = appendEventsMem(id, [
        { ...event, id: event.id },
      ]);
      return { record: clone(cur), event: appended[0]!, transitioned: true };
    },

    async appendEvents(feedbackId, evts) {
      return appendEventsMem(feedbackId, evts);
    },

    async listEvents(feedbackId, opts) {
      return (events.get(feedbackId) ?? [])
        .filter(
          (e) =>
            opts?.visibility === undefined ||
            e.visibility === opts.visibility,
        )
        .map(cloneEvent);
    },

    async markKnowledgeConverted(id, knowledgeItemId, event, expected) {
      const cur = rows.get(id);
      if (!cur) return { marked: false, reason: "missing" };
      if (cur.knowledgeConverted) {
        return { marked: false, reason: "already_converted" };
      }
      if (cur.status !== expected.status) {
        return { marked: false, reason: "status_mismatch" };
      }
      cur.knowledgeConverted = true;
      cur.knowledgeItemId = knowledgeItemId;
      cur.updatedAt = now();
      appendEventsMem(id, [event]);
      return { marked: true, record: clone(cur) };
    },
  };
}
