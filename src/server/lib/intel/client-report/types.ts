// EPIC-262 (SLICE-262-11): client monthly report — canonical
// snapshot (immutable) + versioned editorial layer + SENT lifecycle
// (D-UX-Q4). The canonical half references the signed IntelReport;
// it is never edited — a data error means a new scan, not a patch.

export type ClientReportStatus =
  | "GENERATED"
  | "IN_REVIEW"
  | "APPROVED"
  | "SENT";

/** One editorial revision — Pryme's words, kept separately from
 *  canonical facts. New edits append a revision; old ones stay. */
export interface EditorialRevision {
  version: number;
  /** hero summary line shown at the top of the client page */
  heroLine: string;
  /** "what changed" — free text, one item per line in markdown */
  whatChanged: string;
  /** "next month" — planned fixes/re-scans, free text */
  nextMonth: string;
  /** internal note — never rendered to the client page */
  internalNote: string;
  editedBy: string; // operator id
  editedAt: string; // ISO
}

/** Immutable canonical half — extracted once from the signed report
 *  at generation time; identifies the source report unforgeably. */
export interface ClientReportCanonical {
  reportId: string;
  scanId: string;
  contentHash: string; // sha256:… — reproducibility anchor
  keyId: string;
  generatedAt: string; // ISO — of the source report
  completeness: "complete" | "partial";
  ruleset: { name: string; version: string };
  scores: {
    readiness: number | null;
    exposure: number | null;
  };
  findingCounts: { pass: number; fail: number; warn: number; unknown: number };
  /** rule_ids of fail/warn findings — drives "attention" + delta */
  openFindingRuleIds: string[];
  provenance: Record<string, number>;
  envelopeCount: number;
}

/** Month-over-month delta vs the previous client report on the same
 *  site — only when the previous report used a compatible ruleset.
 *  null = "first period" / ruleset changed (honest, not zero). */
export interface ClientReportDelta {
  prevReportId: string;
  readinessDelta: number | null; // null when either score null
  exposureDelta: number | null;
  newOpenRuleIds: string[];
  closedRuleIds: string[];
}

export interface ClientReport {
  id: string; // cr_<ulid>
  siteId: string;
  tenantId: string;
  /** "2026-11" — one report per site+period (unique) */
  period: string;
  status: ClientReportStatus;
  canonical: ClientReportCanonical;
  delta: ClientReportDelta | null;
  /** current editorial draft */
  editorial: EditorialRevision;
  /** prior editorial versions, oldest first (current excluded) */
  editorialHistory: EditorialRevision[];
  approvedBy: string | null;
  sentBy: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntelClientReportStore {
  insert(r: ClientReport): Promise<ClientReport>;
  byId(id: string): Promise<ClientReport | null>;
  update(r: ClientReport): Promise<ClientReport>;
  forSite(siteId: string): Promise<ClientReport[]>;
  /** latest prior report on the site for delta computation */
  latestBeforePeriod(siteId: string, period: string): Promise<ClientReport | null>;
}
