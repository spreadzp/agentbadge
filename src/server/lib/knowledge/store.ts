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
  /** Arc R2 M-1: OPEN/TRIAGED dedupe hits always bump; RESOLVED hits
   *  reopen; WONTFIX is final (recorded:false). Only NEW rows consume
   *  openCap — checked INSIDE the write tx (insert + count + rollback)
   *  so a full backlog can't be raced past nor block dedupe bumps. */
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
    orderBy?: "count" | "lastSeen";
    limit?: number;
    /** Arc R2 M-1: bounded pagination so a full backlog never has to
     *  materialize in one response. */
    offset?: number;
  }): Promise<KnowledgeGapRecord[]>;
  transitionGap(
    id: string,
    input: {
      from: string;
      to: string;
      linkedItemId?: string | null;
      /** SLICE-264-10: written on EVERY transition — REQUIRED so an
       *  omission can't silently wipe the stamp (RESOLVED → ISO,
       *  anything else → null). */
      resolvedAt: string | null;
    },
  ): Promise<{
    gap: KnowledgeGapRecord | null;
    transitioned: boolean;
    reason?: "missing" | "status_mismatch";
  }>;
  /** SLICE-264-10: idempotent ownership overwrite — assign,
   *  unassign (null fields), reassign and dueAt changes all funnel
   *  here. No CAS on the values themselves: a lost race is covered
   *  by the 264-11 assignment audit events, not by refusing. */
  assignGap(
    id: string,
    input: KnowledgeGapAssignment,
  ): Promise<{
    gap: KnowledgeGapRecord | null;
    updated: boolean;
    reason?: "missing";
  }>;
}

/** SLICE-264-10: the four ownership columns, written atomically.
 *  All nullable — unassign clears the triple; setGapDueAt passes
 *  the current row's values through unchanged. */
export interface KnowledgeGapAssignment {
  assignedTo: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  dueAt: string | null;
}
