/**
 * EPIC-229: write-input shapes for the knowledge store contract —
 * split out of store.ts (300-line cap). The iface in store.ts
 * imports + re-exports them; all consumer imports stay `./store`.
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
