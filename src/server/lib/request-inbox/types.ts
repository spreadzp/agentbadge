/**
 * EPIC-252 (SLICE-252-1): domain types for the Agent Request Inbox.
 * Store implementations (Postgres adapter / in-memory) share these
 * record shapes — the DB row type (`Models.public_AgentRequest`) is
 * mapped at the adapter boundary so routes/tests never see codecs.
 */

/** A2A-compatible state vocabulary (D-252-Q1). */
export type InboxRequestState =
  | "submitted"
  | "working"
  | "completed"
  | "failed";

/**
 * Secret-stripped requester fingerprint snapshot (D-252-Q2, amended).
 * Resolved client IP IS stored here (ops abuse investigation) — but it
 * is still never returned by public endpoints, only via ops routes.
 */
export interface InboxFingerprint {
  /** Resolved client IP — ops-only, kept out of public responses. */
  ip: string | null;
  ua: string | null;
  referer: string | null;
  src: string | null;
  /** Allowlisted-safe header snapshot — authorization/cookie/token
   *  headers are removed by `buildFingerprint`. */
  headers: Record<string, string>;
  /** HMAC-SHA256(ua+headers+salt) — IP-less fingerprint for the rotation-proof
   *  soft rate lane (SLICE-252-7). Optional for back-compat with rows
   *  written before the dual-lane limiter. */
  softFpHash?: string;
}

export interface InboxRequestRecord {
  id: string;
  state: InboxRequestState | string;
  kind: string | null;
  /** Original prompt (≤256KB) — null after janitor payload purge. */
  payload: unknown | null;
  fingerprint: InboxFingerprint;
  /** HMAC-SHA256(ip+ua+env-salt) — keys dedupe and the 252-2 rate-limit. */
  fpHash: string;
  agentId: string | null;
  verified: boolean;
  response: unknown | null;
  spamFlag: boolean;
  idempotencyKey: string | null;
  /** Row TTL — past this the request answers 410 and may be deleted. */
  expiresAtMs: number;
  createdAtMs: number;
  respondedAtMs: number | null;
}

export interface InboxQaPair {
  id: string;
  /** sha256(normalized question) — corpus dedupe key. */
  questionHash: string;
  question: string;
  response: unknown;
  sourceRequestId: string;
  uses: number;
  createdAtMs: number;
}

export interface InboxSurveyRecord {
  id: string;
  title: string;
  questions: unknown;
  active: boolean;
  closesAtMs: number | null;
  createdAtMs: number;
}

export interface InboxSurveyAnswer {
  id: string;
  surveyId: string;
  agentId: string | null;
  fpHash: string | null;
  answers: unknown;
  /** true once credited into ReputationWrite (verified only, 252-4). */
  rated: boolean;
  createdAtMs: number;
}
