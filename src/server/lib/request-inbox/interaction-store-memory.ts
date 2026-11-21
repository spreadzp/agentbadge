import type {
  InteractionEventRecord,
  InteractionResponseRecord,
  InteractionSessionRecord,
} from "./interaction-types";
import { STATUS_TO_STATE } from "./interaction-types";
import type { RequestInboxData } from "./store";
import type { InboxRequestRecord } from "./types";
import type {
  InteractionEventInput,
  InteractionStore,
} from "./interaction-store";

const TERMINAL = new Set(["completed", "failed"]);

function cloneInteraction(r: InboxRequestRecord): InboxRequestRecord {
  return {
    ...r,
    // Deep-copy the mutable JSON fields — a caller mutating
    // record.payload/topics would otherwise write straight into the
    // store's row (arc nit).
    payload: r.payload == null ? r.payload : structuredClone(r.payload),
    response: r.response == null ? r.response : structuredClone(r.response),
    topics: Array.isArray(r.topics) ? [...r.topics] : r.topics,
    entities: Array.isArray(r.entities) ? [...r.entities] : r.entities,
    demandSignals: Array.isArray(r.demandSignals)
      ? [...r.demandSignals]
      : r.demandSignals,
    fingerprint: { ...r.fingerprint, headers: { ...r.fingerprint.headers } },
  };
}

function cloneEvent(e: InteractionEventRecord): InteractionEventRecord {
  return { ...e };
}

/**
 * In-memory interaction store — MUST receive the shared
 * `RequestInboxData` so its rows are the same map RequestStore uses
 * (D-228-10: one inbox in memory mode, exactly like the shared table).
 */
export function createMemoryInteractionStore(
  data: RequestInboxData,
): InteractionStore {
  const { rows, sessions, events, responses } = data;

  const appendEventsMem = (
    requestId: string,
    evts: InteractionEventInput[],
    nowMs: number,
  ): InteractionEventRecord[] => {
    if (evts.length === 0) return [];
    const log = events.get(requestId) ?? [];
    let seq = log.reduce((m, e) => Math.max(m, e.seq), 0);
    const out: InteractionEventRecord[] = [];
    for (const e of evts) {
      seq += 1;
      const rec: InteractionEventRecord = {
        id: e.id ?? crypto.randomUUID(),
        requestId,
        seq,
        kind: e.kind,
        visibility: e.visibility,
        payload: e.payload,
        createdAtMs: e.createdAtMs ?? nowMs,
      };
      log.push(rec);
      out.push(cloneEvent(rec));
    }
    events.set(requestId, log);
    return out;
  };

  const touchSession = (input: {
    id: string;
    actorRef?: string | null;
    seenAtMs: number;
  }): { session: InteractionSessionRecord; created: boolean } => {
    const cur = sessions.get(input.id);
    if (!cur) {
      const session: InteractionSessionRecord = {
        id: input.id,
        actorRef: input.actorRef ?? null,
        firstSeenAtMs: input.seenAtMs,
        lastSeenAtMs: input.seenAtMs,
        requestCount: 1,
        createdAtMs: input.seenAtMs,
      };
      sessions.set(session.id, session);
      return { session: { ...session }, created: true };
    }
    cur.lastSeenAtMs = input.seenAtMs;
    cur.requestCount += 1;
    if (cur.actorRef == null && input.actorRef != null) {
      cur.actorRef = input.actorRef;
    }
    return { session: { ...cur }, created: false };
  };

  return {
    async submitInteraction(input, evts) {
      if (input.idempotencyKey) {
        for (const r of rows.values()) {
          if (
            r.idempotencyKey === input.idempotencyKey &&
            r.fpHash === input.fpHash
          ) {
            return { record: cloneInteraction(r), duplicate: true };
          }
        }
      }
      const nowMs = input.createdAtMs ?? Date.now();
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
        createdAtMs: nowMs,
        respondedAtMs: null,
        actorResolution: input.actorResolution,
        actorRef: input.actorRef ?? null,
        sessionId: input.sessionId ?? null,
        channel: input.channel,
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
      appendEventsMem(record.id, evts, nowMs);
      const session = input.sessionId
        ? touchSession({
            id: input.sessionId,
            actorRef: input.actorRef ?? null,
            seenAtMs: nowMs,
          }).session
        : null;
      return { record: cloneInteraction(record), duplicate: false, session };
    },

    async classify(id, patch, evts, nowMs) {
      const r = rows.get(id);
      if (!r) return null;
      if (patch.intent !== undefined) r.intent = patch.intent;
      if (patch.signalType !== undefined) r.signalType = patch.signalType;
      if (patch.outcome !== undefined) r.outcome = patch.outcome;
      if (patch.knowledgeGap !== undefined) r.knowledgeGap = patch.knowledgeGap;
      if (patch.topics !== undefined) r.topics = patch.topics;
      if (patch.entities !== undefined) r.entities = patch.entities;
      if (patch.demandSignals !== undefined)
        r.demandSignals = patch.demandSignals;
      if (patch.classifiedBy !== undefined) r.classifiedBy = patch.classifiedBy;
      const transitioned = r.state === "submitted";
      if (transitioned) r.state = "working";
      appendEventsMem(id, evts, nowMs ?? Date.now());
      return { record: cloneInteraction(r), transitioned };
    },

    async respond(id, response, evts, nowMs) {
      const t = nowMs ?? Date.now();
      const r = rows.get(id);
      if (!r) return { record: null, transitioned: false };
      if (TERMINAL.has(r.state)) {
        return { record: cloneInteraction(r), transitioned: false };
      }
      r.state = "completed";
      r.response = { answer: response.body };
      r.respondedAtMs = t;
      const resp: InteractionResponseRecord = {
        id: response.id,
        requestId: response.requestId,
        operatorRef: response.operatorRef,
        body: response.body,
        createdAtMs: response.createdAtMs ?? t,
      };
      const list = responses.get(id) ?? [];
      list.push(resp);
      responses.set(id, list);
      appendEventsMem(id, evts, t);
      return { record: cloneInteraction(r), transitioned: true };
    },

    async reject(id, evts, nowMs) {
      const t = nowMs ?? Date.now();
      const r = rows.get(id);
      if (!r) return { record: null, transitioned: false };
      if (TERMINAL.has(r.state)) {
        return { record: cloneInteraction(r), transitioned: false };
      }
      r.state = "failed";
      appendEventsMem(id, evts, t);
      return { record: cloneInteraction(r), transitioned: true };
    },

    async listQueue(opts) {
      const state = opts?.status ? STATUS_TO_STATE[opts.status] : undefined;
      let out = [...rows.values()];
      if (state !== undefined) out = out.filter((r) => r.state === state);
      if (opts?.actorResolution !== undefined) {
        out = out.filter((r) => r.actorResolution === opts.actorResolution);
      }
      if (opts?.beforeMs !== undefined) {
        // Keyset cursor: next page = rows strictly AFTER the last
        // seen createdAtMs (arc H/M2 — `<` replayed the oldest page).
        out = out.filter((r) => r.createdAtMs > opts.beforeMs!);
      }
      out.sort(
        (a, b) => a.createdAtMs - b.createdAtMs || (a.id < b.id ? -1 : 1),
      );
      return out.slice(0, opts?.limit ?? 500).map(cloneInteraction);
    },

    async listBySession(sessionId, limit = 100) {
      return [...rows.values()]
        .filter((r) => r.sessionId === sessionId)
        .sort((a, b) => a.createdAtMs - b.createdAtMs)
        .slice(0, limit)
        .map(cloneInteraction);
    },

    async getSession(id) {
      const s = sessions.get(id);
      return s ? { ...s } : null;
    },

    async upsertSession(input) {
      return touchSession(input);
    },

    async appendEvents(requestId, evts, nowMs) {
      return appendEventsMem(requestId, evts, nowMs ?? Date.now());
    },

    async listEvents(requestId, opts) {
      const log = events.get(requestId) ?? [];
      return log
        .filter(
          (e) => opts?.visibility === undefined || e.visibility === opts.visibility,
        )
        .map(cloneEvent);
    },

    async listResponses(requestId) {
      return (responses.get(requestId) ?? []).map((r) => ({ ...r }));
    },
  };
}
