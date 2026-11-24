// EPIC-262 (SLICE-262-27b): monitoring — the requires-attention
// feed. Alerts are DERIVED at read from portfolio rows +
// attestations (same view-time honesty as attentionFor: nothing
// stored, nothing drifts). Severity groups the feed P1 → P3.
import { attentionFor, type AttentionReason } from "../dashboard/freshness";
import type { PortfolioRow } from "../dashboard/data";
import {
  effectiveStatus,
  type IntelAttestation,
} from "../attestation";

export type AlertReason =
  | AttentionReason
  | "attestation_expiring"
  | "attestation_revoked";

export type AlertSeverity = "P1" | "P2" | "P3";

const SEVERITY: Record<AlertReason, AlertSeverity> = {
  exposure_fail: "P1",
  failed_scan: "P1",
  stale: "P2",
  partial_scan: "P2",
  attestation_expiring: "P2",
  attestation_revoked: "P2",
  no_scan: "P3",
  consent_revoked: "P3",
};

export const ATTESTATION_EXPIRING_DAYS = 14;

export interface IntelAlert {
  /** deterministic — dedupe/идемпотентность без stored state */
  id: string;
  site_id: string;
  hostname: string | null;
  severity: AlertSeverity;
  reason: AlertReason;
  headline: string;
  detail: string;
  /** what the operator should do — actionable, not decorative */
  action: string;
  href: string;
}

const siteLabel = (row: PortfolioRow) => row.hostname ?? row.site.id;

function reasonAlert(
  row: PortfolioRow,
  reason: AttentionReason,
): IntelAlert {
  const label = siteLabel(row);
  const j = row.latestJob;
  const ex = j?.report?.scores.exposure;
  const base = {
    id: `${row.site.id}:${reason}`,
    site_id: row.site.id,
    hostname: row.hostname,
    severity: SEVERITY[reason],
    reason,
    href: `/intel/sites/${row.site.id}`,
  };
  switch (reason) {
    case "exposure_fail":
      return {
        ...base,
        headline: `${label}: ${ex?.fail ?? "?"} exposure finding(s)`,
        detail: `Exposure score ${ex?.score ?? "—"} — ${ex?.fail ?? 0} fail of ${ex?.evaluable ?? 0} evaluable checks.`,
        action: "Open the report and close the exposed surface.",
      };
    case "failed_scan":
      return {
        ...base,
        headline: `${label}: last scan failed`,
        detail: j?.error ? `Error: ${j.error}` : "The scan job ended in status failed.",
        action: "Re-run the scan; check the error and site connectivity.",
      };
    case "stale":
      return {
        ...base,
        headline: `${label}: evidence is stale`,
        detail: `Newest evidence is ${Math.round(
          (Date.now() - Date.parse(
            j?.report?.evidence.received_at_max ??
              j?.finishedAt ??
              j?.createdAt ??
              new Date().toISOString(),
          )) / 86_400_000,
        )}d old — the report no longer describes the site.`,
        action: "Re-scan to refresh evidence.",
      };
    case "partial_scan":
      return {
        ...base,
        headline: `${label}: last scan was partial`,
        detail: `${j?.probeFailures ?? 0} of ${j?.probeTotal ?? 0} probes failed — some checks are unknown, not passed.`,
        action: "Re-scan; investigate unreachable probes.",
      };
    case "no_scan":
      return {
        ...base,
        headline: `${label}: never scanned`,
        detail: "The site is registered but has no scan data yet.",
        action: "Run the first scan.",
      };
    case "consent_revoked":
      return {
        ...base,
        headline: `${label}: audit consent revoked`,
        detail: "Scans are blocked until consent is re-granted.",
        action: "Re-grant audit consent if monitoring should continue.",
      };
  }
}

function attestationAlerts(
  row: PortfolioRow,
  attestations: IntelAttestation[] | undefined,
  nowIso: string,
): IntelAlert[] {
  if (!attestations || attestations.length === 0) return [];
  const latest = attestations.reduce((a, b) =>
    a.issued >= b.issued ? a : b,
  );
  const status = effectiveStatus(latest, nowIso);
  const label = siteLabel(row);
  const base = {
    site_id: row.site.id,
    hostname: row.hostname,
    href: `/intel/sites/${row.site.id}`,
  };
  const alerts: IntelAlert[] = [];
  if (status === "revoked") {
    alerts.push({
      ...base,
      id: `${row.site.id}:attestation_revoked`,
      severity: "P2",
      reason: "attestation_revoked",
      headline: `${label}: attestation revoked`,
      detail: latest.revoked_reason
        ? `Revoked ${latest.revoked_at?.slice(0, 10)} — ${latest.revoked_reason}`
        : `Revoked ${latest.revoked_at?.slice(0, 10)}.`,
      action: "Issue a fresh attestation from the latest report if publication should continue.",
    });
  } else if (status === "active") {
    const daysLeft = Math.ceil(
      (Date.parse(latest.valid_until) - Date.parse(nowIso)) / 86_400_000,
    );
    if (daysLeft <= ATTESTATION_EXPIRING_DAYS) {
      alerts.push({
        ...base,
        id: `${row.site.id}:attestation_expiring`,
        severity: "P2",
        reason: "attestation_expiring",
        headline: `${label}: attestation expires in ${daysLeft}d`,
        detail: `Valid until ${latest.valid_until.slice(0, 10)} — the public verification card will show expired after that.`,
        action: "Re-attest the latest report to renew the validity window.",
      });
    }
  }
  return alerts;
}

const SEV_RANK: Record<AlertSeverity, number> = { P1: 0, P2: 1, P3: 2 };

/** The fleet feed — one alert per (site, reason), sorted by
 *  severity then the 27a attention weight inside each band. */
export function buildAlerts(
  rows: PortfolioRow[],
  attestationsForSite: Map<string, IntelAttestation[]> = new Map(),
  now = new Date(),
): IntelAlert[] {
  const nowIso = now.toISOString();
  const items: { alert: IntelAlert; weight: number }[] = [];
  for (const row of rows) {
    const attention = attentionFor(row, now);
    for (const reason of attention.reasons) {
      items.push({ alert: reasonAlert(row, reason), weight: attention.weight });
    }
    for (const alert of attestationAlerts(
      row,
      attestationsForSite.get(row.site.id),
      nowIso,
    )) {
      items.push({ alert, weight: attention.weight });
    }
  }
  return items
    .sort(
      (a, b) =>
        SEV_RANK[a.alert.severity] - SEV_RANK[b.alert.severity] ||
        b.weight - a.weight,
    )
    .map((x) => x.alert);
}
