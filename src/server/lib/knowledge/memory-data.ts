import type {
  KnowledgeCapabilityRecord,
  KnowledgeEvidenceRecord,
  KnowledgeGapRecord,
  KnowledgeItemRecord,
  KnowledgeRelationRecord,
  KnowledgeStatusEventRecord,
  KnowledgeVersionRecord,
} from "./types";

/** D-229-9: ≤50 evidence refs per version. */
export const KNOWLEDGE_EVIDENCE_CAP = 50;
/** D-229-7: ≤10 verbatim samples per gap. */
export const KNOWLEDGE_GAP_SAMPLES_CAP = 10;

export interface MemoryKnowledgeData {
  items: Map<string, KnowledgeItemRecord>;
  versions: Map<string, KnowledgeVersionRecord>;
  events: Map<string, KnowledgeStatusEventRecord>;
  capabilities: Map<string, KnowledgeCapabilityRecord>;
  links: Set<string>; // `${itemId}::${capabilityId}`
  relations: Map<string, KnowledgeRelationRecord>;
  evidence: Map<string, KnowledgeEvidenceRecord>;
  gaps: Map<string, KnowledgeGapRecord>;
}

export function createMemoryKnowledgeData(): MemoryKnowledgeData {
  return {
    items: new Map(),
    versions: new Map(),
    events: new Map(),
    capabilities: new Map(),
    links: new Set(),
    relations: new Map(),
    evidence: new Map(),
    gaps: new Map(),
  };
}

export const nowIso = () => new Date().toISOString();
export const linkKey = (itemId: string, capabilityId: string) =>
  `${itemId}::${capabilityId}`;

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length >= 2);

/**
 * Memory-side naive FTS parity (D-229-4): score = share of distinct
 * query terms present in title+body. Postgres mode uses the real
 * tsvector index — this scorer keeps the SAME output shape
 * (rank/snippet) so the seam contract holds with DATABASE_ENABLED=off.
 * 229-5 refines scorer/rank parity.
 */
export function memorySearchScore(
  query: string,
  title: string,
  body: string,
): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const hay = `${title} ${body}`.toLowerCase();
  let hits = 0;
  for (const t of terms) if (hay.includes(t)) hits += 1;
  return hits / terms.length;
}

export function memorySnippet(
  query: string,
  title: string,
  body: string,
): string {
  const terms = tokenize(query);
  const lower = body.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return title.slice(0, 120);
  const start = Math.max(0, pos - 40);
  const end = Math.min(body.length, pos + 120);
  return `${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
}
