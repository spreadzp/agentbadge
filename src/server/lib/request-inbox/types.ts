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
  /** Resolved client IP — ops-only (abuse investigation, C49
   *  article), never surfaced to public endpoints. */
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
  /** D-256-Q13: requester's opt-in consent to publish the completed
   *  Q&A into the public corpus. Default false — absent consent the
   *  request stays unlisted (readable only via its bearer id). */
  publishToQa: boolean;
  idempotencyKey: string | null;
  /** Row TTL — past this the request answers 410 and may be deleted. */
  expiresAtMs: number;
  createdAtMs: number;
  respondedAtMs: number | null;
  // ─── EPIC-228 (D-228-10): interaction columns on the shared row.
  // NULL on rows written by the legacy /api/requests intake.
  /** D-228-1: ANON|API_KEY|DID — null on pre-228 rows. */
  actorResolution: string | null;
  /** agentId|did — nullable: anon + retention anonymization (O-228-4). */
  actorRef: string | null;
  /** InteractionSession grouping key (A2A contextId, D-228-2). */
  sessionId: string | null;
  /** Ingress channel — null on legacy intake rows. */
  channel: string | null;
  // Operator classification (D-228-5) — admin-surface writes only:
  intent: string | null;
  signalType: string | null;
  outcome: string | null;
  knowledgeGap: boolean;
  topics: unknown | null;
  entities: unknown | null;
  demandSignals: unknown | null;
  classifiedBy: string | null;
}

export interface InboxQaPair {
  /** Public corpus id — `qa_<uuid>` for pairs minted after the
   *  consent gate (D-256-Q14); legacy pairs carry `qa_{requestId}`.
   *  Never expose `sourceRequestId` publicly — it is a bearer id. */
  id: string;
  /** sha256(normalized question) — corpus dedupe key. */
  questionHash: string;
  question: string;
  response: unknown;
  /** Internal audit column — bearer request id, never returned by
   *  public endpoints (D-256-Q14). */
  sourceRequestId: string;
  uses: number;
  /** D-256-Q14: soft retract — set means hidden from search AND the
   *  fast-path; the row + reason are kept for audit. */
  retractedAtMs?: number | null;
  retractReason?: string | null;
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
  /** IP-less fingerprint (HMAC of UA + identity headers). A repeat
   *  on a rotating IP keeps the same softFpHash — matched answers
   *  are accepted but flagged "soft_fp_dup" for ops (D-252-A). */
  softFpHash?: string | null;
  answers: unknown;
  /** Ops-review marker, e.g. "soft_fp_dup" — accepted but suspect. */
  flag?: string | null;
  /** true once credited into ReputationWrite (verified only, 252-4). */
  rated: boolean;
  createdAtMs: number;
}
