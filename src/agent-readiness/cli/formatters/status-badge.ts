import { strongestSource, SOURCE_CLASS_LABELS } from "../../rule-engine/source-hierarchy";
import type { Evidence } from "../../rule-engine/evidence.types";
import type { ReviewLevel } from "../../rule-engine/review-level";

export interface AssertionLike {
  status: string;
  evidence?: Evidence[] | Array<{ type: string; captured_at?: string; source_class?: string }>;
  confidence?: number;
  review_level?: ReviewLevel | string | null;
  source_class?: string | null;
  source_label?: string | null;
  claim?: string;
}

export function formatStatusBadge(a: AssertionLike): string {
  const status = a.status;
  const sourceLabel = a.source_label ?? computeSourceLabel(a.evidence ?? []);
  const reviewChip = formatReviewChip(a.review_level);
  const confidenceStr = a.confidence !== undefined ? ` · ${Math.round(a.confidence * 100)}%` : "";

  if (status === "GAP") {
    return `[GAP]${confidenceStr}${reviewChip}`;
  }
  if (status === "CONFLICT") {
    return `[CONFLICT]${confidenceStr}${reviewChip}`;
  }
  if (status === "VERIFIED" || status === "INFERRED") {
    const via = sourceLabel ? ` via ${sourceLabel}` : "";
    return `[${status}${via}]${confidenceStr}${reviewChip}`;
  }
  if (status === "NOT_APPLICABLE") {
    return `[NOT_APPLICABLE]`;
  }
  return `[${status}]${confidenceStr}`;
}

export function computeSourceLabel(evidence: Evidence[] | Array<{ type: string; captured_at?: string; source_class?: string }>): string | null {
  if (evidence.length === 0) return null;
  if (evidence.length > 0 && typeof (evidence[0] as Evidence).type === "string") {
    const strongest = strongestSource(evidence as Evidence[]);
    if (!strongest) return null;
    return SOURCE_CLASS_LABELS[strongest.sourceClass] ?? null;
  }
  return null;
}

export function formatReviewChip(reviewLevel: ReviewLevel | string | null | undefined): string {
  if (reviewLevel === "automatic") return " (auto)";
  if (reviewLevel === "assisted") return " (assisted)";
  return "";
}

export function formatStatusBadgeHtml(a: AssertionLike): string {
  const status = a.status;
  const sourceLabel = a.source_label ?? computeSourceLabel(a.evidence ?? []);
  const reviewChip = formatReviewChip(a.review_level);
  const confidenceStr = a.confidence !== undefined ? ` · ${Math.round(a.confidence * 100)}%` : "";

  if (status === "GAP") {
    return `<span class="badge badge-gap">GAP</span>${confidenceStr}${reviewChip}`;
  }
  if (status === "CONFLICT") {
    return `<span class="badge badge-conflict">CONFLICT</span>${confidenceStr}${reviewChip}`;
  }
  if (status === "VERIFIED" || status === "INFERRED") {
    const via = sourceLabel ? ` via ${escapeHtml(sourceLabel)}` : "";
    return `<span class="badge badge-verified">${status}${via}</span>${confidenceStr}${reviewChip}`;
  }
  if (status === "NOT_APPLICABLE") {
    return `<span class="badge badge-na">N/A</span>`;
  }
  return `<span class="badge">${escapeHtml(status)}</span>${confidenceStr}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
