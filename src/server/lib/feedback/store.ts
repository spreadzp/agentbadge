import type { FeedbackEventRecord, FeedbackRecord } from "./types";

/**
 * EPIC-230 (SLICE-230-1, D-230-1/4): feedback store contract — the
 * Postgres adapter and the in-memory store share semantics
 * (interaction-store.ts precedent).
 *
 * MUST share:
 * - submitFeedback is atomic: dedupe probe on (idempotencyKey,
 *   dedupeScope), row insert, auto-dedup link (canonical
 *   relatedFeedbackId + relatedCount bump on the earliest OPEN row
 *   sharing `normalized`) and the received events land as ONE unit.
 *   A replay writes nothing and reports duplicate:true.
 * - The status machine is enforced inside the store (Arc R4 M-4):
 *   transitionFeedback refuses illegal jumps and writes NOTHING on
 *   refusal; effects derive from `to` (triagedAt on TRIAGED,
 *   closedAt on CLOSED) — never caller-supplied.
 * - Honest signals: refusals return {transitioned:false, reason},
 *   never throw on a state mismatch.
 * - Events are append-only: seq is assigned per-feedback at append
 *   time; no update/delete on the log.
 */

export interface FeedbackSubmitInput {
  id: string;
  actorResolution: string;
  actorRef?: string | null;
  dedupeScope: string;
  idempotencyKey?: string | null;
  text: string;
  kind?: string | null;
  target?: string | null;
  severity?: string | null;
  normalized: string;
}

export interface FeedbackEventInput {
  id?: string;
  kind: string;
  visibility: string;
  payload: unknown;
}

/** Operator triage patch — dictionary fields + public suggestion. */
export interface FeedbackTriagePatch {
  kind?: string | null;
  target?: string | null;
  severity?: string | null;
  suggestion?: string | null;
}

export interface FeedbackTransitionInput {
  from: string;
  to: string;
  actor: string;
  reason?: string | null;
  patch?: FeedbackTriagePatch;
  /** ISO timestamp for effect columns — caller-supplied so memory
   *  and PG backends stay comparable in tests. */
  now?: string;
}

export type FeedbackTransitionResult =
  | { record: FeedbackRecord; event: FeedbackEventRecord; transitioned: true }
  | {
      record: FeedbackRecord | null;
      event: null;
      transitioned: false;
      reason: "missing" | "status_mismatch" | "illegal";
    };

export interface FeedbackListOpts {
  status?: string;
  kind?: string;
  target?: string;
  limit?: number;
  offset?: number;
}

export interface FeedbackStore {
  readonly backend: "postgres" | "memory";

  getFeedback(id: string): Promise<FeedbackRecord | null>;
  findByIdempotency(
    idempotencyKey: string,
    dedupeScope: string,
  ): Promise<FeedbackRecord | null>;

  /** Operator queue — FIFO by createdAt, offset pagination. */
  listFeedback(opts?: FeedbackListOpts): Promise<FeedbackRecord[]>;

  /**
   * Fresh feedback row + auto-dedup link + received events — atomic.
   * (idempotencyKey, dedupeScope) replay returns the stored row with
   * duplicate:true and writes nothing. `relatedTo` reports the
   * canonical row this submission was threaded under (null when the
   * row starts a new thread).
   */
  submitFeedback(
    input: FeedbackSubmitInput,
    events: FeedbackEventInput[],
  ): Promise<{
    record: FeedbackRecord;
    duplicate: boolean;
    relatedTo: string | null;
  }>;

  /**
   * Status machine inside the store lock: refuses illegal from→to
   * and writes NOTHING on refusal. Effect columns derive from `to`.
   */
  transitionFeedback(
    id: string,
    input: FeedbackTransitionInput,
    event: FeedbackEventInput,
  ): Promise<FeedbackTransitionResult>;

  /** Standalone append — seq auto-assigned per feedback. */
  appendEvents(
    feedbackId: string,
    events: FeedbackEventInput[],
  ): Promise<FeedbackEventRecord[]>;
  listEvents(
    feedbackId: string,
    opts?: { visibility?: string },
  ): Promise<FeedbackEventRecord[]>;

  /** D-230-10 seam — sets knowledgeConverted + knowledgeItemId. */
  markKnowledgeConverted(
    id: string,
    knowledgeItemId: string,
    event: FeedbackEventInput,
  ): Promise<FeedbackRecord | null>;
}
