import type {
  KnowledgeCapabilityRecord,
  KnowledgeEvidenceRecord,
  KnowledgeGapRecord,
  KnowledgeItemRecord,
  KnowledgeRelationRecord,
  KnowledgeSearchHit,
  KnowledgeStatusEventRecord,
  KnowledgeVersionRecord,
} from "./types";
import type {
  KnowledgeGapAssignInput,
  KnowledgeGapEventInsert,
  KnowledgeGapEventRecord,
  KnowledgeGapTransitionInput,
} from "./gap-events";
import type {
  KnowledgeGapOverdueInsert,
  KnowledgeGapOverduePending,
  KnowledgeGapOverdueRecord,
  KnowledgeGapMetrics,
} from "./gap-overdue";
import type {
  KnowledgeCapabilityUpsert,
  KnowledgeEvidenceInsert,
  KnowledgeGapUpsert,
  KnowledgeItemInsert,
  KnowledgeRelationInsert,
  KnowledgeSearchOpts,
  KnowledgeStatusEventInsert,
  KnowledgeVersionInsert,
} from "./store-inputs";

/**
 * EPIC-229 (SLICE-229-1, D-143/D-229-1): knowledge store contract —
 * the Postgres adapter and the memory store share semantics:
 * composite mutations atomic (refused writes store NOTHING);
 * versions + status events append-only; honest signals
 * (`transitioned`, `created`, `recorded`); one searchItems shape —
 * agent callers always status:"PUBLISHED".
 */

/** Arc R4 M-4: the legal from→to table enforced INSIDE the store
 *  — previously workflow-only, so a direct store call could jump
 *  DRAFT→PUBLISHED. Mirror of the PG copy (no cross-package import). */
import type {
  KnowledgeTransitionInput,
  KnowledgeTransitionResult,
} from "./transitions";
export {
  KNOWLEDGE_TRANSITIONS,
  type KnowledgeTransitionInput,
  type KnowledgeTransitionResult,
} from "./transitions";

export interface KnowledgeStore {
  readonly backend: "postgres" | "memory";

  // ─── items ──
  getItem(id: string): Promise<KnowledgeItemRecord | null>;
  getItemBySlug(slug: string): Promise<KnowledgeItemRecord | null>;
  listItems(opts?: {
    status?: string;
    kind?: string;
    limit?: number;
  }): Promise<KnowledgeItemRecord[]>;
  /** Item + version seq=1 + create-event + latest pointer — atomic. */
  createItemWithVersion(
    item: KnowledgeItemInsert,
    version: KnowledgeVersionInsert,
    event: KnowledgeStatusEventInsert,
  ): Promise<{ item: KnowledgeItemRecord; version: KnowledgeVersionRecord }>;
  /** Arc R1 H5 + R2 M-8: appends inside a tx that row-locks the item,
   *  asserts requireStatus (default DRAFT), computes seq = max+1.
   *  expectedSeq is the lost-update precondition ("stale_seq"). */
  addVersion(
    version: Omit<KnowledgeVersionInsert, "seq"> & {
      copyEvidenceFromLatest?: boolean;
      expectedSeq?: number;
    },
    opts?: { requireStatus?: string },
  ): Promise<
    | { ok: true; version: KnowledgeVersionRecord }
    | { ok: false; reason: "missing" | "not_draft" | "stale_seq" }
  >;

  // ─── versions (append-only) ──
  getVersion(id: string): Promise<KnowledgeVersionRecord | null>;
  getVersionBySeq(
    itemId: string,
    seq: number,
  ): Promise<KnowledgeVersionRecord | null>;
  listVersions(itemId: string): Promise<KnowledgeVersionRecord[]>;

  // ─── status machine ──
  transitionItem(
    id: string,
    input: KnowledgeTransitionInput,
  ): Promise<KnowledgeTransitionResult>;
  listStatusEvents(itemId: string): Promise<KnowledgeStatusEventRecord[]>;

  // ─── search seam (D-229-4) ──
  searchItems(opts: KnowledgeSearchOpts): Promise<KnowledgeSearchHit[]>;

  // ─── capabilities ──
  upsertCapability(
    input: KnowledgeCapabilityUpsert,
  ): Promise<{ row: KnowledgeCapabilityRecord; created: boolean }>;
  getCapability(id: string): Promise<KnowledgeCapabilityRecord | null>;
  getCapabilityByName(
    name: string,
  ): Promise<KnowledgeCapabilityRecord | null>;
  listCapabilities(opts?: {
    verified?: boolean;
    kind?: string;
    limit?: number;
  }): Promise<KnowledgeCapabilityRecord[]>;
  linkCapability(
    itemId: string,
    capabilityId: string,
  ): Promise<{ created: boolean }>;
  unlinkCapability(
    itemId: string,
    capabilityId: string,
  ): Promise<{ removed: boolean }>;
  capabilitiesForItem(itemId: string): Promise<KnowledgeCapabilityRecord[]>;
  itemsForCapability(name: string): Promise<string[]>;

  // ─── relations ──
  /** Arc R2 M-7: SUPERSEDES cycle check inside the store — PG locks
   *  both endpoints + bounded recursive CTE; memory runs the same
   *  BFS. Cycles refuse honestly. */
  addRelation(
    input: KnowledgeRelationInsert,
  ): Promise<{
    row: KnowledgeRelationRecord | null;
    created: boolean;
    reason?: "supersedes_cycle" | "supersedes_bound" | "items_missing";
  }>;
  /** Returns the deleted row — the audit event needs the edge's
   *  endpoints + type (Arc R1 H4: no silent mutations). */
  removeRelation(
    id: string,
  ): Promise<{ removed: boolean; row?: KnowledgeRelationRecord }>;
  relationsFor(itemId: string): Promise<{
    outgoing: KnowledgeRelationRecord[];
    incoming: KnowledgeRelationRecord[];
  }>;

  // ─── evidence ──
  /** Arc R1 H4 + R2 H-2: refuses unless item is DRAFT + target is its
   *  latest version — evidence freezes at PENDING. */
  addEvidence(
    input: KnowledgeEvidenceInsert,
  ): Promise<
    | { ok: true; row: KnowledgeEvidenceRecord }
    | {
        ok: false;
        reason: "missing_version" | "cap_exceeded" | "not_editable";
      }
  >;
  listEvidence(versionId: string): Promise<KnowledgeEvidenceRecord[]>;
  /** Arc R1 H4: removeEvidence's DRAFT+latest guard needs version →
   *  item resolution. */
  getEvidence(id: string): Promise<KnowledgeEvidenceRecord | null>;
  /** Arc R3 M-12: returns the deleted row for the audit event. */
  removeEvidence(
    id: string,
  ): Promise<{
    removed: boolean;
    reason?: "not_editable";
    row?: KnowledgeEvidenceRecord;
  }>;
  itemsCiting(uri: string): Promise<KnowledgeEvidenceRecord[]>;

  // ─── gaps ──
  /** Arc R2 M-1: dedupe hits always bump; RESOLVED reopens (cap-
   *  guarded in-tx); WONTFIX is final; only NEW rows eat openCap. */
  recordGap(
    input: KnowledgeGapUpsert,
    opts?: { openCap?: number },
  ): Promise<{
    row: KnowledgeGapRecord | null;
    created: boolean;
    recorded: boolean;
    reopened?: boolean;
  }>;
  getGap(id: string): Promise<KnowledgeGapRecord | null>;
  /** Arc R1 H3: backlog bound — OPEN gaps are capped (COUNT(*) is
   *  cheap; the unique key doesn't bound DISTINCT queries). */
  countGaps(status: string): Promise<number>;
  listGaps(opts?: {
    status?: string;
    /** 264-12: overdue = past-due first; unassigned = the pool. */
    orderBy?: "count" | "lastSeen" | "overdue";
    unassigned?: boolean;
    /** Arc R2 M-1: bounded pagination. */
    limit?: number;
    offset?: number;
  }): Promise<KnowledgeGapRecord[]>;
  transitionGap(
    id: string,
    input: KnowledgeGapTransitionInput,
  ): Promise<{
    gap: KnowledgeGapRecord | null;
    transitioned: boolean;
    reason?: "missing" | "status_mismatch";
  }>;
  /** SLICE-264-10: idempotent ownership overwrite; `expectedAssignedTo`
   *  CAS-guards the write (264-12 review — no lying audit rows). */
  assignGap(
    id: string,
    input: KnowledgeGapAssignInput,
  ): Promise<{
    gap: KnowledgeGapRecord | null;
    updated: boolean;
    reason?: "missing" | "conflict";
  }>;

  // ─── 264-11: persisted gap audit ──
  /** Standalone event append — state+audit pairs pass `event`
   *  through the mutation instead (same-tx guarantee). */
  appendGapEvent(event: KnowledgeGapEventInsert): Promise<boolean>;
  /** Chronological audit trail for one gap (occurredAt ASC). */
  listGapEvents(gapId: string): Promise<KnowledgeGapEventRecord[]>;

  // ─── 264-13: durable overdue-breach records ──
  /** Atomic breach record — (gapId,dueAt) conflict returns the
   *  EXISTING row with created:false; the sweeper needs emittedAt
   *  either way (kill-between-record-and-emit catch-up, C8). */
  recordOverdue(
    input: KnowledgeGapOverdueInsert,
  ): Promise<{ row: KnowledgeGapOverdueRecord | null; created: boolean }>;
  /** Stamp the emit — idempotent (emittedAt IS NULL guard).
   *  Semantics: emit INVOCATION was attempted — the bus is
   *  fire-and-forget, hook delivery is out of scope (C8). */
  markOverdueEmitted(id: string): Promise<{ updated: boolean }>;
  /** Gaps breached at `now` — OPEN|TRIAGED only (isGapOverdue's
   *  liveness rule; `dueAt < now` already excludes NULL). Paged
   *  (500) — overflow drains on later ticks. */
  listDueBreaches(now: string): Promise<KnowledgeGapRecord[]>;
  /** The durable-intent drain — emittedAt IS NULL rows regardless
   *  of gap state (kill-stranded rows still owe their signal). */
  listPendingOverdueEmits(): Promise<KnowledgeGapOverduePending[]>;
  /** 264-14: accountability digest — aggregated counts + resolve
   *  times; `resolvedSince` bounds the timeToClear window. */
  gapMetrics(input: {
    now: string;
    resolvedSince: string;
  }): Promise<KnowledgeGapMetrics>;
}

// SLICE-264-10/11: gap write-input shapes live in gap-events.ts.
export type {
  KnowledgeGapAssignInput,
  KnowledgeGapAssignment,
  KnowledgeGapEventInsert,
  KnowledgeGapTransitionInput,
} from "./gap-events";

// SLICE-264-13: breach-row shapes live in gap-overdue.ts.
export type {
  KnowledgeGapOverdueInsert,
  KnowledgeGapOverduePending,
  KnowledgeGapOverdueRecord,
  KnowledgeGapMetrics,
} from "./gap-overdue";

// Write-input shapes live in store-inputs.ts (300-cap split).
export type {
  KnowledgeCapabilityUpsert,
  KnowledgeEvidenceInsert,
  KnowledgeGapUpsert,
  KnowledgeItemInsert,
  KnowledgeRelationInsert,
  KnowledgeSearchOpts,
  KnowledgeStatusEventInsert,
  KnowledgeVersionInsert,
} from "./store-inputs";
