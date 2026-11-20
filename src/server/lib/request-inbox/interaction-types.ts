/**
 * EPIC-228 (SLICE-228-1, D-228-1/2/4/10): interaction-domain types.
 *
 * The request row is SHARED with the 252 inbox (agentRequest table —
 * no second inbox). Storage keeps the A2A state vocabulary
 * (submitted|working|completed|failed, D-252-Q1); the interaction API
 * speaks the D-228-3 lifecycle — mapping lives here, at the edge.
 */

/** D-228-3 lifecycle vocabulary (API-facing). */
export type InteractionStatus =
  | "PENDING_REVIEW"
  | "IN_REVIEW"
  | "ANSWERED"
  | "REJECTED";

/** D-228-1 actor tiers. */
export type ActorResolution = "ANON" | "API_KEY" | "DID";

/** D-228-8 event visibility — INTERNAL never leaves the admin surface. */
export type EventVisibility = "PUBLIC" | "INTERNAL";

/** API → storage state vocabulary (A2A, D-252-Q1). */
export const STATUS_TO_STATE: Record<InteractionStatus, string> = {
  PENDING_REVIEW: "submitted",
  IN_REVIEW: "working",
  ANSWERED: "completed",
  REJECTED: "failed",
};

/** Storage → API vocabulary; unknown states stay raw (forward-compat). */
export function statusOfState(state: string): InteractionStatus | string {
  switch (state) {
    case "submitted":
      return "PENDING_REVIEW";
    case "working":
      return "IN_REVIEW";
    case "completed":
      return "ANSWERED";
    case "failed":
      return "REJECTED";
    default:
      return state;
  }
}

/** D-228-4 event kinds (append-only InteractionEvent). */
export const INTERACTION_EVENT_KINDS = [
  "interaction.request.received",
  "interaction.request.classified",
  "interaction.response.sent",
  "interaction.request.rejected",
  "interaction.review.required",
] as const;

export type InteractionEventKind = (typeof INTERACTION_EVENT_KINDS)[number];

/** D-228-5 intent dictionary — operator-only writes, extend by migration. */
export const INTERACTION_INTENTS = [
  "CAPABILITY_DISCOVERY",
  "INTEGRATION_HELP",
  "BUG_REPORT",
  "PAYMENT_METHOD",
  "FEATURE_REQUEST",
  "OTHER",
] as const;

/** D-228-5 signal types — «100 questions ≠ 100 buyers». */
export const INTERACTION_SIGNAL_TYPES = [
  "INTEREST",
  "NEED",
  "INTENT",
  "PURCHASE",
] as const;

export interface InteractionSessionRecord {
  id: string;
  actorRef: string | null;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  requestCount: number;
  createdAtMs: number;
}

export interface InteractionResponseRecord {
  id: string;
  requestId: string;
  operatorRef: string;
  body: string;
  createdAtMs: number;
}

export interface InteractionEventRecord {
  id: string;
  requestId: string;
  seq: number;
  kind: string;
  visibility: string;
  payload: unknown;
  createdAtMs: number;
}
