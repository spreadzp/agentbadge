// ─── Source Hierarchy Module — Spec v0.3 §12.3 ───────────────────────────────
// Pure data/computation module: no I/O, no engine imports.
// Classifies every piece of evidence into a ranked source class.

import { z } from "zod";
import type { Evidence } from "./evidence.types";
import type { CheckType } from "../shared.schema";

// ─── Source Class Enum & Type ─────────────────────────────────────────────────

export const sourceClassEnum = z.enum([
  "runtime",
  "machine_readable_spec",
  "machine_readable_guide",
  "official_docs",
  "website_content",
  "ai_inference",
]);

export type SourceClass = z.infer<typeof sourceClassEnum>;

// ─── Ranking (higher = more authoritative) ────────────────────────────────────

export const SOURCE_CLASS_RANK: Record<SourceClass, number> = {
  runtime: 6,
  machine_readable_spec: 5,
  machine_readable_guide: 4,
  official_docs: 3,
  website_content: 2,
  ai_inference: 1,
};

// ─── Labels (UI-ready) ────────────────────────────────────────────────────────

export const SOURCE_CLASS_LABELS: Record<SourceClass, string> = {
  runtime: "Runtime probe",
  machine_readable_spec: "OpenAPI / JSON Schema",
  machine_readable_guide: "Machine-readable guide",
  official_docs: "Official docs",
  website_content: "Website content",
  ai_inference: "AI inference",
};

// ─── Check types that elevate http evidence to runtime ────────────────────────

const RUNTIME_CHECK_TYPES: ReadonlySet<string> = new Set([
  "http_probe",
  "content_parse",
  "header_check",
]);

// ─── Base classification map (evidence type → source class) ───────────────────

const BASE_CLASS_MAP: Record<Evidence["type"], SourceClass> = {
  openapi: "machine_readable_spec",
  json_schema: "machine_readable_spec",
  robots: "machine_readable_guide",
  sitemap: "machine_readable_guide",
  github: "official_docs",
  manual_confirmation: "official_docs",
  html: "website_content",
  http: "website_content",
  cross: "website_content",
};

// ─── classifyEvidence ─────────────────────────────────────────────────────────
// Accepts either an Evidence object or an evidence type string.
// For cross evidence, resolves recursively to strongest member class.

export function classifyEvidence(
  evidence: Evidence | Evidence["type"],
  checkType?: CheckType,
): SourceClass {
  if (typeof evidence === "string") {
    if (evidence === "http") {
      if (checkType && RUNTIME_CHECK_TYPES.has(checkType)) {
        return "runtime";
      }
      return "website_content";
    }
    if (evidence === "cross") {
      return "website_content";
    }
    return BASE_CLASS_MAP[evidence] ?? "website_content";
  }

  const e = evidence;

  if (e.type === "http") {
    if (checkType && RUNTIME_CHECK_TYPES.has(checkType)) {
      return "runtime";
    }
    return "website_content";
  }

  if (e.type === "cross") {
    if (e.sources.length === 0) {
      return "website_content";
    }
    let bestClass: SourceClass = "website_content";
    let bestRank = 0;
    for (const src of e.sources) {
      const cls = classifyEvidence(src, checkType);
      const rank = SOURCE_CLASS_RANK[cls];
      if (rank > bestRank) {
        bestRank = rank;
        bestClass = cls;
      }
    }
    return bestClass;
  }

  return BASE_CLASS_MAP[e.type] ?? "website_content";
}

// ─── strongestSource ──────────────────────────────────────────────────────────

export function strongestSource(
  evidence: Evidence[],
  checkType?: CheckType,
): { evidence: Evidence; sourceClass: SourceClass } | null {
  if (evidence.length === 0) return null;

  let bestIdx = 0;
  let bestClass = classifyEvidence(evidence[0], checkType);
  let bestRank = SOURCE_CLASS_RANK[bestClass];

  for (let i = 1; i < evidence.length; i++) {
    const cls = classifyEvidence(evidence[i], checkType);
    const rank = SOURCE_CLASS_RANK[cls];
    if (rank > bestRank) {
      bestRank = rank;
      bestClass = cls;
      bestIdx = i;
    }
  }

  return { evidence: evidence[bestIdx], sourceClass: bestClass };
}

// ─── sortByRankDescending ─────────────────────────────────────────────────────
// Stable sort: equal ranks preserve insertion order.

export function sortByRankDescending(
  evidence: Evidence[],
  checkType?: CheckType,
): Evidence[] {
  return [...evidence].sort((a, b) => {
    const rankA = SOURCE_CLASS_RANK[classifyEvidence(a, checkType)];
    const rankB = SOURCE_CLASS_RANK[classifyEvidence(b, checkType)];
    return rankB - rankA;
  });
}
