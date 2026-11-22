import type {
  ReviewCaseRecord,
  ReviewDecisionRecord,
  ReviewEventRecord,
  ReviewEvidenceRecord,
} from "./types";
import { REVIEW_TRANSITIONS } from "./types";
import type { ReviewEventInput, ReviewStore } from "./store";
import { createMemoryEvidenceOps } from "./store-memory-evidence";
import { createMemoryDecisionOps } from "./store-memory-decisions";

/**
 * EPIC-230 (SLICE-230-1, D-229-1/D-143): in-memory review store —
 * behavioral parity with the Postgres adapter (same status machine,
 * same two-sided evidence gate, same ≤50 cap, same append-only
 * decisions + events).
 *
 * "Atomic" = synchronous body inside the async method: a refusal
 * writes NOTHING, exactly like a rolled-back tx. Split per
 * store-memory-*.ts convention (knowledge precedent).
 */

export interface ReviewMemoryData {
  cases: Map<string, ReviewCaseRecord>;
  evidence: Map<string, ReviewEvidenceRecord[]>;
  decisions: Map<string, ReviewDecisionRecord[]>;
  events: Map<string, ReviewEventRecord[]>;
}

export function createMemoryReviewData(): ReviewMemoryData {
  return {
    cases: new Map(),
    evidence: new Map(),
    decisions: new Map(),
    events: new Map(),
  };
}

export const cloneCase = (r: ReviewCaseRecord): ReviewCaseRecord => ({
  ...r,
  agentCriteria:
    r.agentCriteria == null ? r.agentCriteria : structuredClone(r.agentCriteria),
});
export const cloneEvent = (e: ReviewEventRecord): ReviewEventRecord => ({
  ...e,
});
const clone = cloneCase;

export type AppendEvents = (
  reviewId: string,
  evts: ReviewEventInput[],
) => ReviewEventRecord[];

/** Arc 230-8 M14: idempotency probes must not be an O(store) scan —
 *  the public submit path drives one per POST. */
const idemKey = (scope: string, key: string) => `${scope} ${key}`;

export function createMemoryReviewStore(data: ReviewMemoryData): ReviewStore {
  const { cases, events } = data;
  const byIdem = new Map<string, ReviewCaseRecord>();
  const now = () => new Date().toISOString();

  const appendEventsMem: AppendEvents = (reviewId, evts) => {
    if (evts.length === 0) return [];
    const log = events.get(reviewId) ?? [];
    let seq = log.reduce((m, e) => Math.max(m, e.seq), 0);
    const out: ReviewEventRecord[] = [];
    for (const e of evts) {
      seq += 1;
      const rec: ReviewEventRecord = {
        id: e.id ?? crypto.randomUUID(),
        reviewId,
        seq,
        kind: e.kind,
        visibility: e.visibility,
        payload: e.payload,
        createdAt: now(),
      };
      log.push(rec);
      out.push(cloneEvent(rec));
    }
    events.set(reviewId, log);
    return out;
  };

  const evidenceOps = createMemoryEvidenceOps(data, appendEventsMem, now);
  const decisionOps = createMemoryDecisionOps(data, appendEventsMem, now);

  return {
    backend: "memory",

    async getReview(id) {
      const r = cases.get(id);
      return r ? clone(r) : null;
    },

    async findByIdempotency(idempotencyKey, dedupeScope) {
      const hit = byIdem.get(idemKey(dedupeScope, idempotencyKey));
      return hit ? clone(hit) : null;
    },

    async listReviews(opts) {
      let out = [...cases.values()];
      if (opts?.status !== undefined) {
        out = out.filter((r) => r.status === opts.status);
      }
      if (opts?.reviewType !== undefined) {
        out = out.filter((r) => r.reviewType === opts.reviewType);
      }
      if (opts?.assignee !== undefined) {
        out = out.filter((r) => r.assignee === opts.assignee);
      }
      out.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : 1),
      );
      const offset = Math.max(0, opts?.offset ?? 0);
      // Arc 230-8 nit: store-side limit ceiling (repo parity: ≤1000).
      const limit = Math.min(opts?.limit ?? 100, 1000);
      return out.slice(offset, offset + limit).map(clone);
    },

    async submitReview(input, rows, evts) {
      if (input.idempotencyKey) {
        const existing = await this.findByIdempotency(
          input.idempotencyKey,
          input.dedupeScope,
        );
        if (existing) return { record: existing, duplicate: true };
      }
      const t = now();
      const record: ReviewCaseRecord = {
        id: input.id,
        actorResolution: input.actorResolution,
        actorRef: input.actorRef ?? null,
        dedupeScope: input.dedupeScope,
        idempotencyKey: input.idempotencyKey ?? null,
        reviewType: input.reviewType,
        workRef: input.workRef,
        agentCriteria: input.agentCriteria ?? null,
        status: "PENDING_TRIAGE",
        assignee: null,
        claimedAt: null,
        decidedAt: null,
        deliveredAt: null,
        declineReason: null,
        reopenCount: 0,
        latestDecisionSeq: null,
        knowledgeConverted: false,
        knowledgeItemId: null,
        createdAt: t,
        updatedAt: t,
      };
      cases.set(record.id, record);
      if (record.idempotencyKey !== null) {
        byIdem.set(idemKey(record.dedupeScope, record.idempotencyKey), record);
      }
      const list = data.evidence.get(record.id) ?? [];
      for (const e of rows) {
        list.push({
          id: e.id,
          reviewId: record.id,
          type: e.type,
          uri: e.uri,
          label: e.label ?? null,
          description: e.description ?? null,
          submittedBy: e.submittedBy,
          createdAt: t,
        });
      }
      if (rows.length > 0) data.evidence.set(record.id, list);
      appendEventsMem(record.id, evts);
      return { record: clone(record), duplicate: false };
    },

    addEvidence: evidenceOps.addEvidence,
    listEvidence: evidenceOps.listEvidence,

    async transitionReview(id, input, event) {
      const cur = cases.get(id);
      if (!cur) {
        return { record: null, event: null, transitioned: false, reason: "missing" };
      }
      if (cur.status !== input.from) {
        return { record: clone(cur), event: null, transitioned: false, reason: "status_mismatch" };
      }
      const legal = REVIEW_TRANSITIONS[
        input.from as keyof typeof REVIEW_TRANSITIONS
      ]?.has(input.to as never);
      if (legal !== true) {
        return { record: clone(cur), event: null, transitioned: false, reason: "illegal" };
      }
      if (input.to === "DECLINED" && !input.declineReason) {
        return { record: clone(cur), event: null, transitioned: false, reason: "precondition_required" };
      }
      if (input.to === "DECIDED") {
        // Arc 230-8 H3: DECIDED is decideReview's edge — a bare
        // transition would flip status with no decision row.
        return { record: clone(cur), event: null, transitioned: false, reason: "precondition_required" };
      }
      const t = input.now ?? now();
      cur.status = input.to;
      cur.updatedAt = t;
      // Effects derive from `to` — never caller-set.
      if (input.to === "IN_REVIEW") {
        cur.assignee = input.actor;
        cur.claimedAt = t;
      }
      if (input.to === "DECLINED") cur.declineReason = input.declineReason ?? null;
      if (input.to === "REOPENED") {
        cur.reopenCount += 1;
        cur.decidedAt = null;
        cur.deliveredAt = null;
        // Arc 230-8 M11: a reopened case may convert again after the
        // next decision — the superseded draft keeps its own item id.
        cur.knowledgeConverted = false;
        cur.knowledgeItemId = null;
      }
      if (input.to === "PENDING_TRIAGE") {
        cur.assignee = null;
        cur.claimedAt = null;
      }
      const appended = appendEventsMem(id, [event]);
      return { record: clone(cur), event: appended[0]!, transitioned: true };
    },

    decideReview: decisionOps.decideReview,
    listDecisions: decisionOps.listDecisions,

    async appendEvents(reviewId, evts) {
      return appendEventsMem(reviewId, evts);
    },

    async listEvents(reviewId, opts) {
      return (events.get(reviewId) ?? [])
        .filter(
          (e) =>
            opts?.visibility === undefined ||
            e.visibility === opts.visibility,
        )
        .map(cloneEvent);
    },

    async markKnowledgeConverted(id, knowledgeItemId, event, expected) {
      const cur = cases.get(id);
      if (!cur) return { marked: false, reason: "missing" };
      if (cur.knowledgeConverted) {
        return { marked: false, reason: "already_converted" };
      }
      if (
        cur.status !== expected.status ||
        (expected.latestDecisionSeq !== undefined &&
          cur.latestDecisionSeq !== expected.latestDecisionSeq)
      ) {
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
