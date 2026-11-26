import type {
  AgentQAPairUpsert,
  AgentRequestRepository,
  AgentRequestUpsert,
} from "@agentbadge/database";

import type { SubmitInput, RequestStore } from "./store";
import type {
  InboxFingerprint,
  InboxQaPair,
  InboxRequestRecord,
} from "./types";
import { maybeEnqueueWebhook, type WebhookSink } from "../webhooks/types";

/** EPIC-252 (SLICE-252-1): Postgres adapter — codec rows → domain
 *  records. The survey facet lives in survey-store-db.ts (file-size
 *  guard, SLICE-233-3). */

// Row types derive from the repository signatures — the emitted
// `Models` namespace is not part of the package's public surface.
type Repo = AgentRequestRepository;
type ReqRow = NonNullable<Awaited<ReturnType<Repo["get"]>>>;
type QaRow = NonNullable<Awaited<ReturnType<Repo["getQaByHash"]>>>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null =>
  v == null ? null : Number(v);
const json = (v: unknown): unknown => v;

/** D-233-5: callbackUrl rides inside the `fingerprint` jsonb column
 *  (ops-only, outlives payload purge) — a dedicated agentRequest
 *  column needs an @agentbadge/database republish + migration,
 *  deferred to the 233-4 outbox window (EPIC-232 migration queue). */
export const CALLBACK_URL_FP_KEY = "callback_url";
const cbOf = (fp: unknown): string | null =>
  ((fp as Record<string, unknown> | null)?.[CALLBACK_URL_FP_KEY] ??
    null) as string | null;
/** Forward-compat: the dedicated `agentRequest.callbackUrl` column
 *  lands with the 233-4 republish (migration 20261126T1355) — read it
 *  preferentially when the row carries it, else the fp tunnel. */
const cbRow = (r: ReqRow): string | null =>
  ((r as { callbackUrl?: string | null }).callbackUrl ?? null) ||
  cbOf(r.fingerprint);

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
  publishToQa: r.publishToQa,
  idempotencyKey: r.idempotencyKey,
  callbackUrl: cbRow(r),
  expiresAtMs: num(r.expiresAtMs),
  createdAtMs: num(r.createdAtMs),
  respondedAtMs: numOrNull(r.respondedAtMs),
  // EPIC-228 interaction columns (null on pre-228 rows).
  actorResolution: r.actorResolution,
  actorRef: r.actorRef,
  sessionId: r.sessionId,
  channel: r.channel,
  intent: r.intent,
  signalType: r.signalType,
  outcome: r.outcome,
  knowledgeGap: r.knowledgeGap,
  topics: json(r.topics),
  entities: json(r.entities),
  demandSignals: json(r.demandSignals),
  classifiedBy: r.classifiedBy,
});
export { toRequest };

const toQa = (r: QaRow): InboxQaPair => ({
  id: r.id,
  questionHash: r.questionHash,
  question: r.question,
  response: json(r.response),
  sourceRequestId: r.sourceRequestId,
  uses: r.uses,
  retractedAtMs: numOrNull(r.retractedAtMs),
  retractReason: r.retractReason,
  createdAtMs: num(r.createdAtMs),
});

export function createDbRequestStore(
  repo: AgentRequestRepository,
  webhookSink?: WebhookSink,
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
        fingerprint: {
          ...input.fingerprint,
          ...(input.callbackUrl != null
            ? { [CALLBACK_URL_FP_KEY]: input.callbackUrl }
            : {}),
        } as unknown as AgentRequestUpsert["fingerprint"],
        fpHash: input.fpHash,
        agentId: input.agentId ?? null,
        verified: input.verified ?? false,
        publishToQa: input.publishToQa ?? false,
        idempotencyKey: input.idempotencyKey ?? null,
        expiresAtMs: input.expiresAtMs,
        createdAtMs: input.createdAtMs ?? Date.now(), channel: input.channel ?? null,
      };
      const row = await repo.put(upsert);
      return { record: toRequest(row), duplicate: false };
    },

    async findByIdempotency(idempotencyKey, fpHash) {
      const row = await repo.findByIdempotency(idempotencyKey, fpHash);
      return row ? toRequest(row) : null;
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
      if (!row) return null;
      const record = toRequest(row);
      // D-233-5: enqueue right at the transition commit point. True
      // same-tx (outbox insert inside the transition's transaction)
      // needs WebhookOutboxRepository support — lands with the
      // @agentbadge/database republish; the sink is currently the
      // shared memory outbox.
      await maybeEnqueueWebhook(webhookSink, record);
      return record;
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

    async retractQaPair(id, reason, retractedAtMs) {
      const row = await repo.retractQaPair(
        id,
        reason,
        retractedAtMs ?? Date.now(),
      );
      return row ? toQa(row) : null;
    },

    async getQaByHash(questionHash) {
      const row = await repo.getQaByHash(questionHash);
      return row ? toQa(row) : null;
    },

    async getQaByHashIncludingRetracted(questionHash) {
      const row = await repo.getQaByHashIncludingRetracted(questionHash);
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

export type { SubmitInput };
