/**
 * EPIC-231 (SLICE-231-1, D-231-1..5): demand domain types.
 *
 * Store implementations (Postgres adapter / in-memory) share these
 * record shapes — DB rows are mapped at the adapter boundary
 * (lib/feedback precedent). Timestamps are ISO strings
 * (pg/timestamptz-string codec output); createdAtMs is the domain
 * ms clock used by dedupe windows and metrics.
 */

/** D-231-2 signal sources — closed vocabulary, validated at adapters. */
export const DEMAND_SOURCES = [
  "DEMAND_API",
  "INTERACTION",
  "KNOWLEDGE_GAP",
  "FEEDBACK",
] as const;
export type DemandSource = (typeof DEMAND_SOURCES)[number];

/**
 * D-231-3 level ladder — fixed promotion order.
 * `declaredLevel` (source claim) is capped at PURCHASE_INTENT;
 * `level` (effective) is set only by system rules or an operator.
 * VERIFIED_DEMAND can never be minted from agent text (§16.1) —
 * payment/escrow fact, confirmed deal, or operator action only.
 */
export const DEMAND_LEVELS = [
  "INTEREST",
  "NEED",
  "INTENT",
  "PURCHASE_INTENT",
  "VERIFIED_DEMAND",
] as const;
export type DemandLevel = (typeof DEMAND_LEVELS)[number];

export const DEMAND_LEVEL_RANK: Readonly<Record<DemandLevel, number>> = {
  INTEREST: 1,
  NEED: 2,
  INTENT: 3,
  PURCHASE_INTENT: 4,
  VERIFIED_DEMAND: 5,
};

/** D-231-4 actor tiers (D-228-1). */
export const ACTOR_RESOLUTIONS = ["ANON", "API_KEY", "DID"] as const;
export type ActorResolution = (typeof ACTOR_RESOLUTIONS)[number];

/** Cluster lifecycle (D-231-4): OPEN → TRIAGED → LINKED | DISMISSED. */
export const DEMAND_CLUSTER_STATUSES = [
  "OPEN",
  "TRIAGED",
  "LINKED",
  "DISMISSED",
] as const;
export type DemandClusterStatus = (typeof DEMAND_CLUSTER_STATUSES)[number];

/**
 * Legal from→to table — enforced INSIDE the store on BOTH backends
 * (Arc R4 M-4 lesson). The Postgres adapter delegates to
 * DemandRepository which holds a verified-identical mirror under
 * FOR UPDATE; the memory store reads this table directly.
 */
export const DEMAND_CLUSTER_TRANSITIONS: Readonly<
  Record<DemandClusterStatus, ReadonlySet<DemandClusterStatus>>
> = {
  OPEN: new Set(["TRIAGED", "DISMISSED"]),
  // Arc 231 R1 M10: TRIAGED→LINKED stays legal ONLY with a linkRef
  // (enforced inside both stores — the repo FOR UPDATE path and the
  // memory twin refuse bare LINKED); the table stays in parity.
  TRIAGED: new Set(["OPEN", "LINKED", "DISMISSED"]),
  LINKED: new Set(),
  DISMISSED: new Set(["OPEN"]),
};

/** Opportunity lifecycle (D-231-5):
 *  PROPOSED → EVALUATING → ACCEPTED|DECLINED → LINKED → SHIPPED/CLOSED. */
export const DEMAND_OPPORTUNITY_STATUSES = [
  "PROPOSED",
  "EVALUATING",
  "ACCEPTED",
  "DECLINED",
  "LINKED",
  "SHIPPED",
  "CLOSED",
] as const;
export type DemandOpportunityStatus =
  (typeof DEMAND_OPPORTUNITY_STATUSES)[number];

/** Arc 231 R1 M10: field edits (updateOpportunity) are allowed only
 *  while the opportunity is still being shaped — linked and
 *  terminal rows refuse (Postgres twin exports the same set). */
export const EDITABLE_OPPORTUNITY_STATUSES: ReadonlySet<DemandOpportunityStatus> =
  new Set(["PROPOSED", "EVALUATING", "ACCEPTED"]);

export const DEMAND_OPPORTUNITY_TRANSITIONS: Readonly<
  Record<DemandOpportunityStatus, ReadonlySet<DemandOpportunityStatus>>
> = {
  PROPOSED: new Set(["EVALUATING", "DECLINED"]),
  EVALUATING: new Set(["ACCEPTED", "DECLINED"]),
  // Arc 231 R1 M10: bare ACCEPTED→LINKED is out of the table —
  // LINKED is reachable only through linkBacklogTask so a LINKED
  // row always carries backlogTaskId (invariant was op-level only).
  ACCEPTED: new Set(["DECLINED"]),
  DECLINED: new Set(),
  LINKED: new Set(["SHIPPED", "CLOSED"]),
  SHIPPED: new Set(),
  CLOSED: new Set(),
};

/** Append-only demand event kinds (D-231-1, §11 names). */
export const DEMAND_EVENT_KINDS = [
  "demand.signal.created",
  "demand.signal.retagged",
  "demand.cluster.updated",
  "demand.opportunity.created",
  "demand.opportunity.updated",
  "demand.opportunity.linked",
] as const;
export type DemandEventKind = (typeof DEMAND_EVENT_KINDS)[number];

/** DemandEvent entity addressing — one seq chain per (type, id). */
export type DemandEntityType = "signal" | "cluster" | "opportunity";

/** D-228-8: INTERNAL events never leave the admin surface. */
export type EventVisibility = "PUBLIC" | "INTERNAL";

export interface DemandSignalRecord {
  id: string;
  source: string;
  /** Originating row ref for pull-model seams (agentRequest/gap/feedback id). */
  sourceRef: string | null;
  dedupeScope: string;
  idempotencyKey: string | null;
  /** trim+lower+collapse-ws — retained dedupe artifact (O3). */
  normalizedText: string;
  /** Verbatim caller text — retention-bounded, nulled past the horizon (O3). */
  context: string | null;
  contextRetainUntil: string | null;
  category: string | null;
  feature: string | null;
  /** → KnowledgeCapability.name (229 registry). */
  capabilityKey: string | null;
  declaredLevel: string;
  level: string;
  actorResolution: string;
  actorRef: string | null;
  sessionId: string | null;
  /** sha256(normalizedText+actorRef+window) — burst-dedupe probe. */
  dedupeKey: string;
  relatedCount: number;
  /** Points at the earliest canonical row; NULL on canonicals. */
  relatedSignalId: string | null;
  clusterId: string | null;
  createdAtMs: number;
  createdAt: string;
}

export interface DemandClusterRecord {
  id: string;
  /** normalize(category+feature) — the deterministic upsert key. */
  clusterKey: string;
  category: string | null;
  feature: string | null;
  capabilityKey: string | null;
  /** Canonical signals attached — burst dups never count (§13.2). */
  count: number;
  /** Distinct (actorResolution, actorRef) over canonical signals. */
  uniqueActors: number;
  /** {level: n} over canonical signal.level. */
  levelBreakdown: Record<string, number>;
  /** Effective cluster level — monotone-max / CAS-promoted. */
  level: string;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface DemandOpportunityRecord {
  id: string;
  clusterId: string;
  status: string;
  title: string;
  hypothesis: string | null;
  expectedValue: string | null;
  /** Cluster counters frozen at proposal time. */
  metricsSnapshot: Record<string, unknown> | null;
  /** Set by the «→ Backlog task» operator gesture → status LINKED. */
  backlogTaskId: string | null;
  declineReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface DemandEventRecord {
  id: string;
  entityType: string;
  entityId: string;
  seq: number;
  kind: string;
  visibility: string;
  payload: unknown;
  /** ev:{source}:{sourceId}:{seq} — replay-safe appends. */
  idempotencyKey: string | null;
  createdAt: string;
}
