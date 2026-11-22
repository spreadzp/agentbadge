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
 * EPIC-229 (SLICE-229-1, D-143/D-229-1): knowledge store contract.
 *
 * Same dual-mode rule as request-inbox: the Postgres adapter
 * (store-db.ts → KnowledgeRepository/KnowledgeTaxonomyRepository) and
 * the in-memory implementation share semantics — routes/tests only
 * see this iface.
 *
 * Semantics the implementations MUST share:
 * - Composite mutations are atomic: createItemWithVersion writes
 *   item + version + create-event + pointer as one unit; transitionItem
 *   flips status + audit event + publish pointer all-or-nothing (a
 *   refused transition writes NOTHING).
 * - Versions and status events are append-only — no update/delete.
 * - Honest signals: `transitioned` reports whether status actually
 *   moved; `created` reports a fresh row vs a dedupe/upsert hit.
 * - searchItems returns ONE output shape regardless of backend —
 *   agent callers always pass status:"PUBLISHED" (draft/pending
 *   content never crosses the seam boundary).
 * - recordGap upserts on normalizedQuery: create {count:1} or bump
 *   count + lastSeenAt + sample append ≤10; `created` is true only
 *   on first sighting (gap.detected emit key).
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

export interface KnowledgeTransitionInput {
  from: string;
  to: string;
  actor: string;
  reason?: string | null;
  /** Set publishedVersionId = latestVersionId (VERIFIED→PUBLISHED). */
  publish?: boolean;
  /** Clear publishedVersionId (WITHDRAWN). */
  unpublish?: boolean;
  eventId?: string;
}

export type KnowledgeTransitionResult =
  | {
      item: KnowledgeItemRecord;
      event: KnowledgeStatusEventRecord;
      transitioned: true;
    }
  | {
      item: KnowledgeItemRecord | null;
      event: null;
      transitioned: false;
      reason: "missing" | "status_mismatch";
    };

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
  /** Arc R1 H5: append version inside one tx that row-locks the item,
   *  asserts status === requireStatus (default DRAFT) and computes
   *  seq = max+1 under the lock — a concurrent submit can no longer
   *  pin a version the reviewer never saw, and seq races can't reach
   *  the unique index. copyEvidenceFromVersionId copies the previous
   *  version's evidence refs into the new row atomically (D-229-9:
   *  provenance survives re-versioning). Refusal is honest. */
  addVersion(
    version: Omit<KnowledgeVersionInsert, "seq"> & {
      copyEvidenceFromVersionId?: string;
    },
    opts?: { requireStatus?: string },
  ): Promise<
    | { ok: true; version: KnowledgeVersionRecord }
    | { ok: false; reason: "missing" | "not_draft" }
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
  addRelation(
    input: KnowledgeRelationInsert,
  ): Promise<{ row: KnowledgeRelationRecord | null; created: boolean }>;
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
  /** Arc R1 H4: refuses unless the parent item is DRAFT or PENDING
   *  and the target is its latest version (evidence freezes once the
   *  item leaves the review lane). */
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
  removeEvidence(
    id: string,
  ): Promise<{ removed: boolean; reason?: "not_editable" }>;
  itemsCiting(uri: string): Promise<KnowledgeEvidenceRecord[]>;

  // ─── gaps ──
  recordGap(
    input: KnowledgeGapUpsert,
  ): Promise<{ row: KnowledgeGapRecord; created: boolean }>;
  getGap(id: string): Promise<KnowledgeGapRecord | null>;
  /** Arc R1 H3: backlog bound — the public ask surface creates rows,
   *  so OPEN gaps are capped (COUNT(*) is cheap, unique key is not
   *  a bound on DISTINCT queries). */
  countGaps(status: string): Promise<number>;
  listGaps(opts?: {
    status?: string;
    orderBy?: "count" | "lastSeen";
    limit?: number;
  }): Promise<KnowledgeGapRecord[]>;
  transitionGap(
    id: string,
    input: { from: string; to: string; linkedItemId?: string | null },
  ): Promise<{
    gap: KnowledgeGapRecord | null;
    transitioned: boolean;
    reason?: "missing" | "status_mismatch";
  }>;
}
