// EPIC-262 (SLICE-262-27a): freshness + attention — the single
// honest function behind the portfolio sort, the attention strip
// and the pilot digest. Staleness is a VIEW-TIME computation over
// evidence recency — the signed report never carries it (immutable).
// DESIGN §S2.1: stale > 30d; sort "worst exposure → stale → no data".

import type { PortfolioRow } from "./data";

export const STALE_DAYS = 30;

export type AttentionReason =
  | "exposure_fail"
  | "failed_scan"
  | "stale"
  | "partial_scan"
  | "no_scan"
  | "consent_revoked";

export interface Attention {
  /** days since the newest observed evidence (null = never scanned) */
  scanAgeDays: number | null;
  stale: boolean;
  reasons: AttentionReason[];
  /** sort weight — bigger needs eyes sooner (see scoreRank below) */
  weight: number;
}

const daysBetween = (fromIso: string, now: Date): number =>
  Math.max(
    0,
    Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86_400_000),
  );

/** The freshest signal a site has: newest evidence receive, else the
 *  job's own timestamp. null when the site was never scanned. */
export function scanAgeDays(row: PortfolioRow, now: Date): number | null {
  const j = row.latestJob;
  if (!j) return null;
  const at =
    j.report?.evidence.received_at_max ?? j.finishedAt ?? j.createdAt;
  return at ? daysBetween(at, now) : null;
}

export function attentionFor(row: PortfolioRow, now = new Date()): Attention {
  const j = row.latestJob;
  const reasons: AttentionReason[] = [];
  const age = scanAgeDays(row, now);
  const stale = age !== null && age > STALE_DAYS;

  const ex = j?.report?.scores.exposure;
  // real fails only — a warn is "worth noting", not "broken"; evaluable
  // excludes unknown, so evaluable-pass would silently count warns.
  const exposureFails = ex?.fail ?? 0;

  if (exposureFails > 0) reasons.push("exposure_fail");
  if (j?.status === "failed") reasons.push("failed_scan");
  if (stale) reasons.push("stale");
  if (j?.status === "partial") reasons.push("partial_scan");
  if (!j) reasons.push("no_scan");
  if (row.consent === "revoked") reasons.push("consent_revoked");

  // DESIGN §S2.1 order: worst exposure → stale → no data. A failed
  // scan is fresher signal than mere staleness (something actively
  // broke), consent_revoked without findings ranks lowest — the row
  // is dimmed, not alarming.
  const weight =
    exposureFails > 0
      ? 300 + exposureFails
      : j?.status === "failed"
        ? 250
        : stale
          ? 200 + Math.min(age ?? 0, 90)
          : j?.status === "partial"
            ? 150
            : !j
              ? 100
              : row.consent === "revoked"
                ? 40
                : 10;

  return { scanAgeDays: age, stale, reasons, weight };
}

/** Tenant-scoped pilot digest — the machine-readable form of the
 *  attention strip. Empty portfolio → honest zeros, never a stub. */
export interface DigestSite {
  site_id: string;
  hostname: string | null;
  reasons: AttentionReason[];
  readiness_score: number | null;
  exposure_score: number | null;
  scan_age_days: number | null;
  last_scan_status: string | null;
}
export interface IntelDigest {
  generated_at: string;
  tenant_sites: number;
  need_attention: number;
  last_fleet_scan_at: string | null;
  reasons: Record<AttentionReason, number>;
  sites: DigestSite[];
}

export function buildDigest(
  rows: PortfolioRow[],
  now = new Date(),
): IntelDigest {
  const reasons: Record<AttentionReason, number> = {
    exposure_fail: 0,
    failed_scan: 0,
    stale: 0,
    partial_scan: 0,
    no_scan: 0,
    consent_revoked: 0,
  };
  const weighted: { site: DigestSite; weight: number }[] = [];
  let lastFleet: string | null = null;
  let attention = 0;

  for (const row of rows) {
    const a = attentionFor(row, now);
    for (const r of a.reasons) reasons[r] += 1;
    if (a.reasons.length > 0) attention += 1;
    const jobAt = row.latestJob?.finishedAt ?? row.latestJob?.createdAt ?? null;
    if (jobAt && (!lastFleet || jobAt > lastFleet)) lastFleet = jobAt;
    weighted.push({
      weight: a.weight,
      site: {
        site_id: row.site.id,
        hostname: row.hostname,
        reasons: a.reasons,
        readiness_score:
          row.latestJob?.report?.scores.readiness?.score ?? null,
        exposure_score:
          row.latestJob?.report?.scores.exposure?.score ?? null,
        scan_age_days: a.scanAgeDays,
        last_scan_status: row.latestJob?.status ?? null,
      },
    });
  }
  const sites = weighted
    .sort((x, y) => y.weight - x.weight)
    .map((w) => w.site);
  return {
    generated_at: now.toISOString(),
    tenant_sites: rows.length,
    need_attention: attention,
    last_fleet_scan_at: lastFleet,
    reasons,
    sites,
  };
}
