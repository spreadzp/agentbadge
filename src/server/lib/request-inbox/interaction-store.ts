import type {
  InteractionEventRecord,
  InteractionResponseRecord,
  InteractionSessionRecord,
  InteractionStatus,
} from "./interaction-types";
import type { InboxRequestRecord } from "./types";

/**
 * EPIC-228 (SLICE-228-1, D-228-4/5/10): interaction store contract.
 *
 * Same dual-mode rule as RequestStore: the Postgres adapter
 * (interaction-store-db.ts → InteractionRepository) and this in-memory
 * implementation share semantics — routes/tests only see this iface.
 *
 * Semantics the implementations MUST share:
 * - Composite mutations are atomic: submitInteraction writes
 *   request + events + session-touch as one unit; respond/reject are
 *   all-or-nothing (a refusal writes NOTHING — no response row, no
 *   events).
 * - Honest signals: `transitioned` reports whether the state actually
 *   moved; `created` on upsertSession reports a new grouping.
 * - classify writes provided patch keys on ANY state (re-classify is
 *   legal, D-228-5); state moves submitted→working on first classify.
 * - respond/reject refuse on terminal (completed|failed) rows:
 *   `{record: <current>, transitioned: false}` — record is null only
 *   when the request does not exist.
 * - Events are append-only: seq is assigned per-request at append
 *   time; there is no update/delete on the event log.
 * - Storage state vocabulary stays A2A (submitted|working|completed|
 *   failed); callers map InteractionStatus via STATUS_TO_STATE.
 */

export interface InteractionSubmitInput {
  id: string;
  /** Storage vocabulary — "submitted" for a fresh request. */
  state: string;
  kind?: string | null;
  payload: unknown;
  fingerprint: InboxRequestRecord["fingerprint"];
  fpHash: string;
  agentId?: string | null;
  verified?: boolean;
  publishToQa?: boolean;
  idempotencyKey?: string | null;
  /** D-233-5: pre-validated webhook target (callback-url.ts). */
  callbackUrl?: string | null;
  expiresAtMs: number;
  createdAtMs?: number;
  actorResolution: string;
  actorRef?: string | null;
  sessionId?: string | null;
  channel: string;
}

export interface InteractionEventInput {
  id?: string;
  kind: string;
  visibility: string;
  payload: unknown;
  createdAtMs?: number;
}

export interface InteractionClassifyPatch {
  intent?: string | null;
  signalType?: string | null;
  outcome?: string | null;
  knowledgeGap?: boolean;
  topics?: unknown | null;
  entities?: unknown | null;
  demandSignals?: unknown | null;
  classifiedBy?: string | null;
}

export interface InteractionResponseInsert {
  id: string;
  requestId: string;
  operatorRef: string;
  body: string;
  createdAtMs?: number;
}

export interface InteractionStore {
  /**
   * Fresh interaction row + `events` + session touch (when sessionId
   * set) — atomic. (idempotencyKey, fpHash) replay returns the stored
   * row with duplicate:true and writes nothing.
   */
  submitInteraction(
    input: InteractionSubmitInput,
    events: InteractionEventInput[],
  ): Promise<{
    record: InboxRequestRecord;
    duplicate: boolean;
    session?: InteractionSessionRecord | null;
  }>;

  /** D-228-5 classification — provided keys win; first classify moves
   *  submitted→working (transitioned). Same-unit event append. */
  classify(
    id: string,
    patch: InteractionClassifyPatch,
    events: InteractionEventInput[],
    nowMs?: number,
  ): Promise<{ record: InboxRequestRecord; transitioned: boolean } | null>;

  /** A7: non-terminal → completed + InteractionResponse row +
   *  legacy `response` col dual-write {answer: body} + events.
   *  Terminal/missing → {record|null, transitioned:false}, no writes. */
  respond(
    id: string,
    response: InteractionResponseInsert,
    events: InteractionEventInput[],
    nowMs?: number,
  ): Promise<{ record: InboxRequestRecord | null; transitioned: boolean }>;

  /** Non-terminal → failed + events. Same refusal contract as respond. */
  reject(
    id: string,
    events: InteractionEventInput[],
    nowMs?: number,
  ): Promise<{ record: InboxRequestRecord | null; transitioned: boolean }>;

  /** Operator queue — FIFO; `status` is the API vocabulary (mapped
   *  to storage states internally). `beforeMs` = cursor pagination. */
  listQueue(opts?: {
    status?: InteractionStatus;
    actorResolution?: string;
    limit?: number;
    beforeMs?: number;
  }): Promise<InboxRequestRecord[]>;

  /** Session thread — same sessionId, oldest first. */
  listBySession(sessionId: string, limit?: number): Promise<InboxRequestRecord[]>;

  getSession(id: string): Promise<InteractionSessionRecord | null>;

  /** D-228-2 auto-upsert — created reports a fresh grouping. */
  upsertSession(input: {
    id: string;
    actorRef?: string | null;
    seenAtMs: number;
  }): Promise<{ session: InteractionSessionRecord; created: boolean }>;

  /** Standalone append (REVIEW_REQUIRED etc.) — seq auto-assigned. */
  appendEvents(
    requestId: string,
    events: InteractionEventInput[],
    nowMs?: number,
  ): Promise<InteractionEventRecord[]>;

  listEvents(
    requestId: string,
    opts?: { visibility?: string },
  ): Promise<InteractionEventRecord[]>;

  listResponses(requestId: string): Promise<InteractionResponseRecord[]>;
}

