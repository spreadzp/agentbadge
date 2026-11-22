/**
 * EPIC-230 (SLICE-230-1, D-230-1/4): feedback domain types.
 *
 * Store implementations (Postgres adapter / in-memory) share these
 * record shapes — DB rows are mapped at the adapter boundary
 * (knowledge/types.ts precedent). Timestamps are ISO strings
 * (pg/timestamptz-string codec output).
 */

/** D-230-4 lifecycle: RECEIVED→TRIAGED→ACCEPTED|DECLINED|DUPLICATE→CLOSED. */
export const FEEDBACK_STATUSES = [
  "RECEIVED",
  "TRIAGED",
  "ACCEPTED",
  "DECLINED",
  "DUPLICATE",
  "CLOSED",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * Legal from→to table — enforced INSIDE the store on BOTH backends
 * (Arc R4 M-4 lesson: a direct store call cannot jump
 * RECEIVED→CLOSED). The Postgres adapter delegates to
 * FeedbackRepository, which holds a verified-identical mirror under
 * FOR UPDATE; the memory store reads this table directly.
 */
export const FEEDBACK_TRANSITIONS: Readonly<
  Record<FeedbackStatus, ReadonlySet<FeedbackStatus>>
> = {
  RECEIVED: new Set(["TRIAGED"]),
  TRIAGED: new Set(["ACCEPTED", "DECLINED", "DUPLICATE"]),
  ACCEPTED: new Set(["CLOSED"]),
  DECLINED: new Set(["CLOSED"]),
  DUPLICATE: new Set(["CLOSED"]),
  CLOSED: new Set(),
};

/** D-230-4 typed fields — closed vocabularies, validated at the edge. */
export const FEEDBACK_KINDS = [
  "BUG",
  "FEATURE",
  "DOCS",
  "DX",
  "OTHER",
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_TARGETS = [
  "agent-guide",
  "api",
  "docs",
  "venue",
  "mcp",
  "other",
] as const;
export type FeedbackTarget = (typeof FEEDBACK_TARGETS)[number];

/**
 * D-230-4: severity is an agent HINT, not a platform assertion —
 * suggested vocabulary, free-form storage (operator may rewrite at
 * triage). No enum enforcement (§16.2: agent claim ≠ verified).
 */
export const FEEDBACK_SEVERITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

/** Append-only event log kinds (D-230-1, §11.2 names). */
export const FEEDBACK_EVENT_KINDS = [
  "feedback.received",
  "feedback.triaged",
  "feedback.status_changed",
  "feedback.knowledge_converted",
] as const;
export type FeedbackEventKind = (typeof FEEDBACK_EVENT_KINDS)[number];

/** D-228-8: INTERNAL events never leave the admin surface. */
export type EventVisibility = "PUBLIC" | "INTERNAL";

export interface FeedbackRecord {
  id: string;
  /** D-228-1 actor tier. */
  actorResolution: string;
  actorRef: string | null;
  /** Idempotency scope — (idempotencyKey, dedupeScope) unique pair. */
  dedupeScope: string;
  idempotencyKey: string | null;
  text: string;
  kind: string | null;
  target: string | null;
  severity: string | null;
  /** normalized(text+target) — the auto-dedup join key (D-230-4). */
  normalized: string;
  /** Threads sharing this normalized key (canonical counts itself). */
  relatedCount: number;
  /** Points at the earliest open canonical row; NULL on canonicals. */
  relatedFeedbackId: string | null;
  /** Operator's short verdict text, shown publicly (D-230-9). */
  suggestion: string | null;
  status: string;
  knowledgeConverted: boolean;
  knowledgeItemId: string | null;
  createdAt: string;
  triagedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
}

export interface FeedbackEventRecord {
  id: string;
  feedbackId: string;
  seq: number;
  kind: string;
  visibility: string;
  payload: unknown;
  createdAt: string;
}
