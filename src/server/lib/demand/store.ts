import type {
  DemandClusterRecord,
  DemandEntityType,
  DemandEventRecord,
  DemandOpportunityRecord,
  DemandSignalRecord,
} from "./types";

/**
 * EPIC-231 (SLICE-231-1, D-231-1..5): demand store contract — the
 * Postgres adapter and the in-memory store share semantics
 * (lib/feedback precedent).
 *
 * MUST share:
 * - recordSignal is atomic: replay probe on (idempotencyKey,
 *   dedupeScope), burst-dedup link on dedupeKey (canonical
 *   relatedSignalId + relatedCount bump), cluster upsert by
 *   clusterKey with a full canonical-only recount, and the demand.*
 *   events land as ONE unit. A replay writes nothing and reports
 *   duplicate:true.
 * - Cluster counters are canonical-only (relatedSignalId IS NULL)
 *   — burst repeats never inflate demand (§13.2). uniqueActors =
 *   distinct (actorResolution, actorRef); NULL actorRef collapses
 *   to one unattributed actor (under-count, never over-count).
 * - cluster.level is monotone-max on signal.level inside
 *   recordSignal and CAS-promoted/demoted via applyClusterLevel.
 *   VERIFIED_DEMAND is never minted by the store — it arrives only
 *   on input.level from a system/operator caller (§16.1).
 * - Status machines are enforced inside the store: refusals return
 *   {transitioned:false, reason} and write NOTHING; effects derive
 *   from `to` (closedAt on DECLINED|SHIPPED|CLOSED).
 * - Events are append-only: seq assigned per (entityType, entityId)
 *   at append time; idempotencyKey backstops standalone appends.
 */

export interface DemandSignalInput {
  id: string;
  source: string;
  sourceRef?: string | null;
  dedupeScope: string;
  idempotencyKey?: string | null;
  normalizedText: string;
  context?: string | null;
  /** ISO timestamp — O3 retention horizon for `context`. */
  contextRetainUntil?: string | null;
  category?: string | null;
  feature?: string | null;
  capabilityKey?: string | null;
  declaredLevel: string;
  level: string;
  actorResolution: string;
  actorRef?: string | null;
  sessionId?: string | null;
  dedupeKey: string;
  createdAtMs: number;
}

export interface DemandEventInput {
  id?: string;
  kind: string;
  visibility: string;
  payload: unknown;
  /** ev:{source}:{sourceId}:{seq} — replay-safe appends. */
  idempotencyKey?: string | null;
}

/** Events fan out per entity — the store assigns entityId + seq. */
export interface DemandRecordEvents {
  signal?: DemandEventInput[];
  cluster?: DemandEventInput[];
}

export interface DemandSignalListOpts {
  clusterId?: string;
  source?: string;
  level?: string;
  actorRef?: string;
  /** true → canonical rows only (relatedSignalId IS NULL). */
  canonicalOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface DemandClusterListOpts {
  status?: string;
  level?: string;
  sortBy?: "count" | "uniqueActors" | "lastSeenAt";
  limit?: number;
  offset?: number;
}

export interface DemandOpportunityListOpts {
  status?: string;
  clusterId?: string;
  limit?: number;
  offset?: number;
}

export interface DemandTransitionInput {
  from: string;
  to: string;
  actor: string;
  reason?: string | null;
  /** ISO timestamp for effect columns — caller-supplied so memory
   *  and PG backends stay comparable in tests. */
  now?: string;
}

export interface DemandOpportunityPatch {
  /** Non-nullable column — undefined = keep, never null. */
  title?: string;
  hypothesis?: string | null;
  expectedValue?: string | null;
  declineReason?: string | null;
}

export interface DemandRetagPatch {
  /** Caller-derived clusterKey = normalize(category+feature). */
  clusterKey: string;
  category?: string | null;
  feature?: string | null;
  capabilityKey?: string | null;
}

export type DemandTransitionResult<R> =
  | { record: R; event: DemandEventRecord; transitioned: true }
  | {
      record: R | null;
      event: null;
      transitioned: false;
      reason: "missing" | "status_mismatch" | "illegal";
    };

export interface DemandStore {
  readonly backend: "postgres" | "memory";

  // ─── signals ────────────────────────────────────────────────

  getSignal(id: string): Promise<DemandSignalRecord | null>;
  findSignalByIdempotency(
    idempotencyKey: string,
    dedupeScope: string,
  ): Promise<DemandSignalRecord | null>;
  /** Signal feed — newest first, offset pagination. */
  listSignals(opts?: DemandSignalListOpts): Promise<DemandSignalRecord[]>;

  /**
   * Append a signal + cluster upsert + stat recount + events — atomic.
   * `canonicalOf` reports the canonical row a burst-dup linked under
   * (null when the row starts a new thread).
   */
  recordSignal(
    input: DemandSignalInput,
    clusterKey: string,
    events?: DemandRecordEvents,
  ): Promise<{
    signal: DemandSignalRecord;
    cluster: DemandClusterRecord;
    canonicalOf: string | null;
    duplicate: boolean;
  }>;

  /**
   * Operator re-tag: rewrite dictionary fields and re-attach the
   * canonical signal to the caller-derived clusterKey (get-or-create),
   * recounting both clusters. Linked rows refuse (linked_row).
   */
  retagSignal(
    id: string,
    patch: DemandRetagPatch,
    events?: DemandRecordEvents,
  ): Promise<{
    signal: DemandSignalRecord | null;
    cluster: DemandClusterRecord | null;
    detached: "ok" | "missing" | "linked_row";
  }>;

  // ─── clusters ───────────────────────────────────────────────

  getCluster(id: string): Promise<DemandClusterRecord | null>;
  getClusterByKey(clusterKey: string): Promise<DemandClusterRecord | null>;
  /** Top-N board — sort by count|uniqueActors|lastSeenAt DESC. */
  listClusters(opts?: DemandClusterListOpts): Promise<DemandClusterRecord[]>;

  /** CAS level promotion/demotion — refuses on drift. */
  applyClusterLevel(
    id: string,
    input: { from: string; to: string },
    event: DemandEventInput,
  ): Promise<DemandTransitionResult<DemandClusterRecord>>;

  /** Cluster status machine — refuses illegal from→to, writes NOTHING. */
  transitionCluster(
    id: string,
    input: DemandTransitionInput,
    event: DemandEventInput,
  ): Promise<DemandTransitionResult<DemandClusterRecord>>;

  // ─── opportunities ──────────────────────────────────────────

  getOpportunity(id: string): Promise<DemandOpportunityRecord | null>;
  listOpportunities(
    opts?: DemandOpportunityListOpts,
  ): Promise<DemandOpportunityRecord[]>;

  /** Create on an existing cluster — created:false when missing. */
  createOpportunity(
    input: {
      id: string;
      clusterId: string;
      title: string;
      hypothesis?: string | null;
      expectedValue?: string | null;
      metricsSnapshot?: Record<string, unknown> | null;
      createdBy: string;
    },
    events: DemandEventInput[],
  ): Promise<{ record: DemandOpportunityRecord | null; created: boolean }>;

  /** Opportunity status machine — effects derive from `to`. */
  transitionOpportunity(
    id: string,
    input: DemandTransitionInput & { patch?: DemandOpportunityPatch },
    event: DemandEventInput,
  ): Promise<DemandTransitionResult<DemandOpportunityRecord>>;

  /**
   * «→ Backlog task» operator gesture — CAS-guarded: the caller
   * passes the status it read when it decided to link; drifted or
   * already-linked rows are a refusal, never a silent overwrite.
   */
  linkBacklogTask(
    id: string,
    backlogTaskId: string,
    expected: { status: string },
    event: DemandEventInput,
  ): Promise<
    | { linked: true; record: DemandOpportunityRecord }
    | {
        linked: false;
        reason: "missing" | "status_mismatch" | "already_linked";
      }
  >;

  // ─── events (append-only) ───────────────────────────────────

  /** Standalone append — seq auto-assigned per (entityType, entityId). */
  appendEvents(
    entityType: DemandEntityType,
    entityId: string,
    events: DemandEventInput[],
  ): Promise<DemandEventRecord[]>;

  listEvents(
    entityType: DemandEntityType,
    entityId: string,
    opts?: { visibility?: string },
  ): Promise<DemandEventRecord[]>;
}
