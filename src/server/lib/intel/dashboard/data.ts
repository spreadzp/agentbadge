// EPIC-262 (SLICE-262-10): dashboard data compositors — assemble the
// portfolio/site views from registry + scan-job + consent stores.
// Store-level functions (service.ts is at its line budget); N+1
// queries are honest for the pilot scale (~10 sites).

import type { IntelRegistryStores } from "../registry/store";
import type { IntelConsentStore } from "../consent";
import type { IntelScanJobStore } from "../scan";
import type {
  IntelDomain,
  IntelOwnershipProof,
  IntelSite,
} from "../registry/types";
import type { IntelConsent } from "../consent";
import type { ScanJob } from "../scan";
import { computeMoMDelta, type MoMDelta } from "../delta";
import { attentionFor } from "./freshness";

export interface PortfolioRow {
  site: IntelSite;
  hostname: string | null; // primary active domain
  latestJob: ScanJob | null;
  /** audit consent status — "none" when no row */
  consent: "granted" | "revoked" | "none";
}

export interface SiteDetail {
  site: IntelSite;
  domains: IntelDomain[];
  primaryHostname: string | null;
  ownership: {
    installation_control: IntelOwnershipProof | null;
    domain_control: IntelOwnershipProof | null;
  };
  consents: IntelConsent[];
  latestJob: ScanJob | null;
  /** SLICE-262-12 — delta vs the site's previous report (null when
   *  no prior report or ruleset changed) */
  momDelta: MoMDelta | null;
  /** envelopes of the latest job's scan (empty when no scan) */
  evidence: {
    id: string;
    provenance: string;
    receivedAt: string;
  }[];
  /** SLICE-262-27a — view-time staleness (never on the signed doc) */
  stale: boolean;
  scanAgeDays: number | null;
}

const latest = (jobs: ScanJob[]): ScanJob | null =>
  jobs.length === 0
    ? null
    : jobs.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));

export async function listPortfolio(
  stores: IntelRegistryStores,
  consentStore: IntelConsentStore,
  scanJobs: IntelScanJobStore,
  tenantId: string,
): Promise<PortfolioRow[]> {
  const customers = await stores.customers.forTenant(tenantId);
  const rows: PortfolioRow[] = [];
  for (const customer of customers) {
    for (const site of await stores.sites.forCustomer(customer.id)) {
      const domains = await stores.domains.forSite(site.id);
      const primary = domains.find((d) => d.isPrimary);
      const audit = await consentStore.byScope(site.id, "audit");
      rows.push({
        site,
        hostname: primary?.hostname ?? null,
        latestJob: latest(await scanJobs.forSite(site.id)),
        consent: audit?.status === "granted" && !audit.revokedAt
          ? "granted"
          : audit
            ? "revoked"
            : "none",
      });
    }
  }
  return rows;
}

export async function siteDetail(
  stores: IntelRegistryStores,
  consentStore: IntelConsentStore,
  scanJobs: IntelScanJobStore,
  evidenceStore: {
    forScan(
      siteId: string,
      scanId: string,
    ): Promise<{ id: string; provenance: string; receivedAt: string }[]>;
  },
  siteId: string,
): Promise<SiteDetail | null> {
  const site = await stores.sites.byId(siteId);
  if (!site) return null;
  const domains = await stores.domains.forSite(siteId);
  const jobs = await scanJobs.forSite(siteId);
  const job = latest(jobs);
  // second-latest job WITH a report — the MoM baseline
  const prevReport = jobs
    .filter((j) => job && j.id !== job.id && j.report !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.report ?? null;
  // view-time staleness — consent "none" placeholder keeps the site's
  // own freshness honest (consent state isn't part of scan age)
  const attention = attentionFor({
    site,
    hostname: null,
    latestJob: job,
    consent: "none",
  });
  return {
    site,
    domains,
    primaryHostname: domains.find((d) => d.isPrimary)?.hostname ?? null,
    ownership: {
      installation_control: await stores.ownership.byScope(
        siteId,
        "installation_control",
      ),
      domain_control: await stores.ownership.byScope(
        siteId,
        "domain_control",
      ),
    },
    consents: await consentStore.forSite(siteId),
    latestJob: job,
    momDelta:
      job?.report != null ? computeMoMDelta(prevReport, job.report) : null,
    evidence: job ? await evidenceStore.forScan(siteId, job.scanId) : [],
    stale: attention.stale,
    scanAgeDays: attention.scanAgeDays,
  };
}
