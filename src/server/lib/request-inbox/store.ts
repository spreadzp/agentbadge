import type { SurveyStore } from "./survey-store";
import type { InteractionStore } from "./interaction-store";
import type {
  InteractionEventRecord,
  InteractionResponseRecord,
  InteractionSessionRecord,
} from "./interaction-types";
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
  /** D-233-5: pre-validated callback target (https + SSRF-checked
   *  upstream — see callback-url.ts). */
  callbackUrl?: string | null;
  expiresAtMs: number;
  createdAtMs?: number;
  // ─── EPIC-228 (D-228-10): interaction columns — absent on legacy
  // /api/requests submits (stay NULL on the shared row).
  actorResolution?: string | null;
  actorRef?: string | null;
  sessionId?: string | null;
  channel?: string | null;
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
  /** EPIC-228 (D-228-10): interaction facet on the SAME request data —
   *  sessions/responses/events + interaction-aware mutations. */
  interactions: InteractionStore;
  /** "postgres" | "memory" — janitor logs the active backend. */
  backend: string;
}

/**
 * Shared in-memory state behind RequestStore + InteractionStore
 * (D-228-10): both facets read/write the SAME `rows` map — memory
 * mode must behave exactly like the shared Postgres table, or a
 * legacy /api/requests row would be invisible to the interaction
 * queue (and vice versa). `createMemoryRequestInboxStores` builds
 * one data object and hands it to both store factories.
 */
export interface RequestInboxData {
  rows: Map<string, InboxRequestRecord>;
  qaPairs: Map<string, InboxQaPair>;
  qaByHash: Map<string, string>;
  sessions: Map<string, InteractionSessionRecord>;
  /** Per-requestId event log — ordered by seq (append-only). */
  events: Map<string, InteractionEventRecord[]>;
  /** Per-requestId operator responses — ordered by createdAtMs. */
  responses: Map<string, InteractionResponseRecord[]>;
}

export function createMemoryRequestInboxData(): RequestInboxData {
  return {
    rows: new Map(),
    qaPairs: new Map(),
    qaByHash: new Map(),
    sessions: new Map(),
    events: new Map(),
    responses: new Map(),
  };
}
