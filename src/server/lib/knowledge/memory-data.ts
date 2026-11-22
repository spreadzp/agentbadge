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

import { CJK_TERM, tokenizeTerms } from "./terms";

const hayTokens = (text: string) =>
  new Set(
    text
      .normalize("NFC")
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? [],
  );

/**
 * Memory-side FTS parity (D-229-4 + Arc R2 M-3): score = share of
 * distinct query terms present in title+body — OR semantics like
 * the to_tsquery lane, word-boundary matching (substring includes
 * matched inside unrelated words, inflating rank). Same tokenizer
 * as the composer/adapter so coverage and engine see one term set.
 */
export function memorySearchScore(
  query: string,
  title: string,
  body: string,
): number {
  const terms = tokenizeTerms(query);
  if (terms.length === 0) return 0;
  const text = `${title} ${body}`.normalize("NFC").toLowerCase();
  const hay = hayTokens(text);
  let hits = 0;
  // Arc R3 M-7: CJK terms substring-match (no word boundary exists
  // in unsegmented text) — same rule as composer coverage.
  for (const t of terms) {
    if (CJK_TERM.test(t) ? text.includes(t) : hay.has(t)) hits += 1;
  }
  return hits / terms.length;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Arc R2 M-3: snippet parity with the PG lane — escaped text with
 *  matched terms wrapped in <mark>, not raw operator text. */
export function memorySnippet(
  query: string,
  title: string,
  body: string,
): string {
  const terms = tokenizeTerms(query);
  const lower = body.normalize("NFC").toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (pos === -1 || i < pos)) pos = i;
  }
  const raw =
    pos === -1
      ? title.slice(0, 120)
      : `${pos - 40 > 0 ? "…" : ""}${body.slice(Math.max(0, pos - 40), Math.min(body.length, pos + 120))}${Math.min(body.length, pos + 120) < body.length ? "…" : ""}`;
  let out = escapeHtml(raw);
  for (const t of terms) {
    out = out.replace(new RegExp(escapeRegex(t), "i"), (m) => `<mark>${m}</mark>`);
  }
  return out;
}
const escapeRegex = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
