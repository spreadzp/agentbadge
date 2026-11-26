/**
 * EPIC-233 (SLICE-233-4, D-233-5): webhook outbox contract — persisted
 * delivery rows behind a store interface (D-143 dual-mode pattern:
 * Postgres adapter via WebhookOutboxRepository when the
 * @agentbadge/database republish lands, in-memory otherwise).
 *
 * Lifecycle: queued → delivering → done | failed (dead-letter after
 * WEBHOOK_MAX_ATTEMPTS). `claim` also reclaims `delivering` rows whose
 * lease expired (crash between claim and resolve).
 */

import type { InboxRequestRecord } from "../request-inbox/types";
import { publicResponseFor } from "../request-inbox/poll";

export type WebhookOutboxStatus =
  | "queued"
  | "delivering"
  | "done"
  | "failed";

export interface WebhookOutboxRecord {
  id: string;
  /** AgentRequest.id — unique: one delivery per request (D-233-5). */
  requestId: string;
  callbackUrl: string;
  /** Frozen at enqueue — public poll projection ONLY (D-228-8: never
   *  fingerprint/callback internals/agentId). */
  payload: Record<string, unknown>;
  status: WebhookOutboxStatus;
  /** Attempts consumed — incremented on each claim. */
  attempts: number;
  nextAttemptAtMs: number;
  /** Lease timestamp of the in-flight claim; null when not delivering. */
  lockedAtMs: number | null;
  lastError: string | null;
  createdAtMs: number;
}

export type WebhookOutboxOutcome =
  | { status: "done" }
  | { status: "queued"; nextAttemptAtMs: number; lastError: string }
  | { status: "failed"; lastError: string };

export interface WebhookOutboxStore {
  /** Idempotent by requestId — a re-enqueue returns the existing row. */
  enqueue(rec: WebhookOutboxRecord): Promise<WebhookOutboxRecord>;
  /** Atomically move due rows queued→delivering (attempts++, lease at
   *  nowMs) and reclaim delivering rows locked before `nowMs - leaseMs`. */
  claim(
    nowMs: number,
    limit?: number,
    leaseMs?: number,
  ): Promise<WebhookOutboxRecord[]>;
  resolve(
    id: string,
    outcome: WebhookOutboxOutcome,
  ): Promise<WebhookOutboxRecord | null>;
  get(id: string): Promise<WebhookOutboxRecord | null>;
  listForRequest(requestId: string): Promise<WebhookOutboxRecord[]>;
}

/** Narrow sink for the enqueue-on-terminal hook inside RequestStore. */
export type WebhookSink = Pick<WebhookOutboxStore, "enqueue">;

/** Structural shape of the future @agentbadge/database repository —
 *  the db adapter lights up when the contract republish lands; until
 *  then db-stores falls back to the shared in-memory outbox. */
export type WebhookOutboxRepoLike = WebhookOutboxStore;

/** Terminal request states that trigger a callback delivery. */
export const WEBHOOK_TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "expired",
]);

/** Public projection frozen into the delivery payload — mirrors the
 *  GET /api/requests/:id terminal body (state/response/lifecycle). */
export function webhookPayloadFor(
  record: InboxRequestRecord,
): Record<string, unknown> {
  return {
    event: "request.terminal",
    request_id: record.id,
    state: record.state,
    // M13 (233-10): same allowlist projection as the poll surface —
    // internal response keys never cross the webhook boundary.
    response: publicResponseFor(record.response),
    created_at: record.createdAtMs,
    expires_at: record.expiresAtMs,
  };
}

export function webhookRowFor(
  record: InboxRequestRecord,
  nowMs = Date.now(),
): WebhookOutboxRecord {
  return {
    id: `wh_${record.id.slice(3)}`,
    requestId: record.id,
    callbackUrl: record.callbackUrl!,
    payload: webhookPayloadFor(record),
    status: "queued",
    attempts: 0,
    nextAttemptAtMs: nowMs,
    lockedAtMs: null,
    lastError: null,
    createdAtMs: nowMs,
  };
}

/** Enqueue-on-terminal — the ONLY caller is RequestStore.transition
 *  implementations (same commit point as the state mutation). */
export async function maybeEnqueueWebhook(
  sink: WebhookSink | undefined,
  record: InboxRequestRecord,
): Promise<void> {
  if (
    !sink ||
    !record.callbackUrl ||
    !WEBHOOK_TERMINAL_STATES.has(record.state)
  ) {
    return;
  }
  await sink.enqueue(webhookRowFor(record));
}
