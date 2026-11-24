import { createHash } from "node:crypto";

import { DEMAND_LEVEL_RANK, type DemandLevel } from "./types";

/**
 * EPIC-231 (SLICE-231-2, D-231-3/4): deterministic pipeline
 * primitives — normalize, dedupe probe, cluster key, level clamp.
 * No store access here: pure functions, unit-testable.
 */

/** Canonical text form: NFKC → lowercase → strip Cf (zero-width /
 *  format chars — Arc 231 R1 M3: invisible variants must not evade
 *  burst-dedupe) → map Cc (C0/NUL — the dedupe key joins fields on
 *  \x00 and the PG driver 500s on NUL) to space → collapse ws →
 *  trim. Retained per O3 — it is the dedupe/clustering artifact,
 *  not a verbatim payload. */
export function normalizeDemandText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * D-231-4 burst-dedupe window — same horizon as the idempotency TTL
 * convention (contract-guards IDEM_TTL_MS). Arc 231 R1 M3: the window
 * is ROLLING — a canonical candidate counts only when it is at most
 * 24h older than the incoming signal (`dedupeAfterMs` on the store
 * input). A fixed UTC-day bucket let one actor mint two canonicals
 * per text per midnight and self-inflate `count`.
 */
export const DEMAND_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** sha256(actorRef \x00 normalizedText) — opaque probe (feedback
 *  precedent: uniformly bounded, content-agnostic). The rolling
 *  freshness bound travels separately as `dedupeAfterMs`. */
export function demandDedupeKey(
  normalizedText: string,
  actorRef: string | null,
): string {
  return createHash("sha256")
    .update(`${actorRef ?? ""}\u0000${normalizedText}`)
    .digest("hex");
}

/**
 * Deterministic clusterKey (D-231-4) — three namespaces:
 *   dict:{category}|{feature}      classified pair
 *   dict:{category}|text:{norm}    category known, feature absent —
 *                                  falls back to the normalized text so
 *                                  distinct unclassified features never
 *                                  over-merge into one category bucket
 *   text:{normalizedText}          unclassified — text-level grouping
 *                                  (legacy demand-registry parity)
 */
export function normalizeClusterKey(
  category: string | null,
  feature: string | null,
  normalizedText: string,
): string {
  if (category === null) return `text:${normalizedText}`;
  return `dict:${category}|${feature ?? `text:${normalizedText}`}`;
}

/**
 * D-231-3 + §16.1: a source's claim can never exceed PURCHASE_INTENT.
 * VERIFIED_DEMAND arrives only from a payment/escrow fact, a
 * confirmed deal, or an operator — never from agent text, so the
 * pipeline clamps any VERIFIED claim down to PURCHASE_INTENT.
 * Arc 231 R1 H1: allowlist, not a one-literal denylist — unknown
 * strings ("verified_demand", junk) fall back to INTEREST instead of
 * polluting levelBreakdown with non-ladder values.
 */
export function clampDeclaredLevel(declared: DemandLevel): DemandLevel {
  if (declared === "VERIFIED_DEMAND") return "PURCHASE_INTENT";
  return declared in DEMAND_LEVEL_RANK ? declared : "INTEREST";
}

/** Higher of two levels by rank — the monotone-max helper for
 *  promotion decisions (cluster.level never demotes via rules). */
export function maxLevel(a: DemandLevel, b: DemandLevel): DemandLevel {
  return DEMAND_LEVEL_RANK[a] >= DEMAND_LEVEL_RANK[b] ? a : b;
}
