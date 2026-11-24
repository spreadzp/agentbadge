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

/**
 * EPIC-229 (SLICE-229-1, D-143/D-229-1): knowledge store contract —
 * the Postgres adapter and the memory store share semantics.
 *
 * MUST share: composite mutations atomic (refused writes store
 * NOTHING); versions + status events append-only; honest signals
 * (`transitioned`, `created`, `recorded`); one searchItems shape —
 * agent callers always status:"PUBLISHED"; recordGap upserts on
 * normalizedQuery with `created` true only on first sighting.
 */

export interface KnowledgeItemInsert {
  id: string;
  slug: string;
  kind: string;
  status?: string;
  createdBy: string;
}

export interface KnowledgeVersionInsert {
  id: string;
  itemId: string;
  seq: number;
  title: string;
  body: string;
  summary?: string | null;
  restoredFromVersionId?: string | null;
  createdBy: string;
}

export interface KnowledgeStatusEventInsert {
  id: string;
  itemId: string;
  from: string | null;
  to: string;
  actor: string;
  reason?: string | null;
}

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

export interface KnowledgeCapabilityUpsert {
  id: string;
  name: string;
  kind: string;
  description?: string | null;
  source: string;
  verified: boolean;
}

export interface KnowledgeRelationInsert {
  id: string;
  fromItemId: string;
  toItemId: string;
  type: string;
  createdBy: string;
}

export interface KnowledgeEvidenceInsert {
  id: string;
  versionId: string;
  type: string;
  uri: string;
  label?: string | null;
  addedBy: string;
}

export interface KnowledgeGapUpsert {
  id: string;
  normalizedQuery: string;
  /** Verbatim query text appended to sampleQueries (cap 10). */
  sampleQuery: string;
  source: string;
  sourceRef?: string | null;
  capabilityRef?: string | null;
  intent?: string | null;
}

export interface KnowledgeSearchOpts {
  query: string;
  /** Defaults to PUBLISHED — agent callers never override. */
  status?: string;
  kind?: string | null;
  capabilityRef?: string | null;
  limit?: number;
}

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
   *  expectedSeq is the lost-update precondition ("stale_seq");
   *  copyEvidenceFromLatest copies from the LOCKED latest version. */
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
   *  both endpoints + bounded recursive CTE under the lock; memory
   *  runs the same BFS. Cycles refuse honestly. */
  addRelation(
    input: KnowledgeRelationInsert,
  ): Promise<{
    row: KnowledgeRelationRecord | null;
    created: boolean;
    reason?: "supersedes_cycle" | "supersedes_bound" | "items_missing";
  }>;
  /** Returns the deleted row when found — the audit event needs the
   *  edge's endpoints + type (Arc R1 H4: no silent mutations). */
  removeRelation(
    id: string,
  ): Promise<{ removed: boolean; row?: KnowledgeRelationRecord }>;
  relationsFor(itemId: string): Promise<{
    outgoing: KnowledgeRelationRecord[];
    incoming: KnowledgeRelationRecord[];
  }>;

  // ─── evidence ──
  /** Arc R1 H4 + R2 H-2: refuses unless item is DRAFT + target is its
   *  latest version — evidence freezes at PENDING (no bait-and-switch
   *  on the set a verifier reviews). */
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
  /** Arc R1 H4: evidence lookup by id — the DRAFT+latest guard on
   *  removeEvidence needs version → item resolution. */
  getEvidence(id: string): Promise<KnowledgeEvidenceRecord | null>;
  /** Arc R3 M-12: returns the deleted row — the audit event carries
   *  what was removed (type/uri), not just an id. */
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
   *  guarded in-tx); WONTFIX is final. Only NEW rows consume
   *  openCap — a full backlog can't be raced nor block bumps. */
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
  /** Arc R1 H3: backlog bound — the public ask surface creates rows,
   *  so OPEN gaps are capped (COUNT(*) is cheap, unique key is not
   *  a bound on DISTINCT queries). */
  countGaps(status: string): Promise<number>;
  listGaps(opts?: {
    status?: string;
    /** 264-12: overdue = past-due first; unassigned = the pool. */
    orderBy?: "count" | "lastSeen" | "overdue";
    unassigned?: boolean;
    limit?: number;
    /** Arc R2 M-1: bounded pagination. */
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
  /** SLICE-264-10: idempotent ownership overwrite; 264-12 review —
   *  `expectedAssignedTo` CAS-guards the write so a lost race can't
   *  mint an audit row whose previousAssignee lies. */
  assignGap(
    id: string,
    input: KnowledgeGapAssignInput,
  ): Promise<{
    gap: KnowledgeGapRecord | null;
    updated: boolean;
    reason?: "missing" | "conflict";
  }>;

  // ─── 264-11: persisted gap audit ──
  /** Standalone event append — for audit without a mutation;
   *  state+audit pairs pass `event` through the mutation instead. */
  appendGapEvent(event: KnowledgeGapEventInsert): Promise<boolean>;
  /** Chronological audit trail for one gap (occurredAt ASC). */
  listGapEvents(gapId: string): Promise<KnowledgeGapEventRecord[]>;
}

// SLICE-264-10/11: gap write-input shapes live in gap-events.ts.
export type {
  KnowledgeGapAssignInput,
  KnowledgeGapAssignment,
  KnowledgeGapEventInsert,
  KnowledgeGapTransitionInput,
} from "./gap-events";
