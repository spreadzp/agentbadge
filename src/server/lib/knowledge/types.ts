/**
 * EPIC-229 (SLICE-229-1/2, D-229-1..9): domain types for the Knowledge
 * Engine. Store implementations (Postgres adapter / in-memory) share
 * these record shapes — DB rows are mapped at the adapter boundary
 * (request-inbox/types.ts precedent). Zod schemas validate ALL lib
 * inputs at the edge (D-229-2 limits).
 */

import { z } from "zod";

/** D-229-1: item kinds — closed vocabulary, validated at the lib edge. */
export const KNOWLEDGE_KINDS = [
  "GUIDE",
  "CONCEPT",
  "FAQ",
  "POLICY",
  "CAPABILITY_DOC",
] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** D-229-3: status machine vocabulary. */
export const KNOWLEDGE_STATUSES = [
  "DRAFT",
  "PENDING",
  "VERIFIED",
  "PUBLISHED",
  "WITHDRAWN",
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

/** D-229-8: typed relation edges. */
export const KNOWLEDGE_RELATION_TYPES = [
  "RELATED_TO",
  "SUPERSEDES",
  "DEPENDS_ON",
  "PART_OF",
  "CONTRADICTS",
] as const;
export type KnowledgeRelationType =
  (typeof KNOWLEDGE_RELATION_TYPES)[number];

/** D-229-9: evidence ref types — the trust semantic of a source. */
export const KNOWLEDGE_EVIDENCE_TYPES = [
  "INTERNAL_DOC",
  "EXTERNAL_URL",
  "ONCHAIN_TX",
  "API_ENDPOINT",
  "SCAN_REPORT",
] as const;
export type KnowledgeEvidenceType =
  (typeof KNOWLEDGE_EVIDENCE_TYPES)[number];

/** D-229-5: capability kinds + source. */
export const KNOWLEDGE_CAPABILITY_KINDS = [
  "SCANNER_CHECK",
  "X402_PACK",
  "MCP_TOOL",
  "MANIFEST",
  "MANUAL",
] as const;
export type KnowledgeCapabilityKind =
  (typeof KNOWLEDGE_CAPABILITY_KINDS)[number];
export const KNOWLEDGE_CAPABILITY_SOURCES = ["SEEDED", "MANUAL"] as const;

/** D-229-7: gap sources + lifecycle. INTERACTION_SIGNAL is the
 *  EPIC-228 seam (O-229-6) — classify patches with knowledgeGap:true
 *  route here via the post-commit hook. */
export const KNOWLEDGE_GAP_SOURCES = [
  "COMPOSER_REFUSAL",
  "INTERACTION_SIGNAL",
  "MANUAL",
] as const;
export type KnowledgeGapSource = (typeof KNOWLEDGE_GAP_SOURCES)[number];
export const KNOWLEDGE_GAP_STATUSES = [
  "OPEN",
  "TRIAGED",
  "RESOLVED",
  "WONTFIX",
] as const;
export type KnowledgeGapStatus = (typeof KNOWLEDGE_GAP_STATUSES)[number];

export interface KnowledgeItemRecord {
  id: string;
  slug: string;
  kind: string;
  status: string;
  latestVersionId: string | null;
  publishedVersionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeVersionRecord {
  id: string;
  itemId: string;
  seq: number;
  title: string;
  body: string;
  summary: string | null;
  restoredFromVersionId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface KnowledgeStatusEventRecord {
  id: string;
  itemId: string;
  /** NULL marks the create event. */
  from: string | null;
  to: string;
  actor: string;
  reason: string | null;
  createdAt: string;
}

export interface KnowledgeCapabilityRecord {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  source: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRelationRecord {
  id: string;
  fromItemId: string;
  toItemId: string;
  type: string;
  createdBy: string;
  createdAt: string;
}

export interface KnowledgeEvidenceRecord {
  id: string;
  versionId: string;
  type: string;
  uri: string;
  label: string | null;
  addedBy: string;
  createdAt: string;
}

export interface KnowledgeGapRecord {
  id: string;
  normalizedQuery: string;
  sampleQueries: string[];
  count: number;
  capabilityRef: string | null;
  intent: string | null;
  source: string;
  /** ireq_* of the 228 request that flagged the gap (O-229-6). */
  sourceRef: string | null;
  status: string;
  linkedItemId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Unified search output shape — FTS and memory backends return the
 *  same structure (D-229-4 seam contract). */
export interface KnowledgeSearchHit {
  itemId: string;
  slug: string;
  kind: string;
  versionId: string;
  title: string;
  summary: string | null;
  snippet: string;
  rank: number;
}

// ─── SLICE-229-2: input validation (D-229-2 limits) ──────────────

export const KNOWLEDGE_TITLE_MAX = 300;
export const KNOWLEDGE_BODY_MAX = 64 * 1024; // 64KB
export const KNOWLEDGE_SUMMARY_MAX = 2000;

/** H-229 fix: NUL/C0 controls crash the PG driver (500) — reject
 *  them at the schema edge, honest 400. \t \n \r stay legal in body. */
const noControlChars = (s: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s);
const CTRL_MSG = "control characters (incl. NUL) not allowed";

const titleSchema = z
  .string()
  .trim()
  .min(1)
  .max(KNOWLEDGE_TITLE_MAX)
  .refine(noControlChars, { message: CTRL_MSG });
const bodySchema = z
  .string()
  .min(1)
  .max(KNOWLEDGE_BODY_MAX)
  .refine(noControlChars, { message: CTRL_MSG });
const summarySchema = z
  .string()
  .trim()
  .min(1)
  .max(KNOWLEDGE_SUMMARY_MAX)
  .refine(noControlChars, { message: CTRL_MSG });

export const createKnowledgeItemInputSchema = z.object({
  slug: z.string().optional(),
  kind: z.enum(KNOWLEDGE_KINDS),
  title: titleSchema,
  body: bodySchema,
  summary: summarySchema.optional(),
});
export type CreateKnowledgeItemInput = z.infer<
  typeof createKnowledgeItemInputSchema
>;

export const updateKnowledgeDraftInputSchema = z
  .object({
    title: titleSchema.optional(),
    body: bodySchema.optional(),
    summary: summarySchema.nullish(),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined || v.summary !== undefined, {
    message: "at least one field required",
  });
export type UpdateKnowledgeDraftInput = z.infer<
  typeof updateKnowledgeDraftInputSchema
>;
