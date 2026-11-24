// EPIC-262 (SLICE-262-32): support diagnostics — resolve ANY intel
// id (site/scan/job/pjob/env) to a single assembled card a Pryme
// operator can act on, plus an honest severity suggestion. Still
// tenant-scoped (D-262-Q14): support sees own-tenant sites only;
// an unknown or foreign id answers 404 with no leak.
import type { IntelRegistryStores } from "./registry/store";
import type { IntelConsentStore } from "./consent";
import type { IntelScanJobStore } from "./scan";
import type { IntelPullJobStore, IntelSecurityEventStore } from "./pull";
import type { IntelEvidenceStore } from "./evidence/store";

export type SupportSeverity = "P1" | "P2" | "P3";

export interface SupportDeps {
  registryStores: IntelRegistryStores;
  consent: IntelConsentStore;
  scanJobs: IntelScanJobStore;
  evidence: IntelEvidenceStore;
  pullJobs?: IntelPullJobStore;
  securityEvents?: IntelSecurityEventStore;
}

export type SupportIdKind = "site" | "scan" | "scan_job" | "pull_job" | "envelope";

/** Prefix → kind. Unknown prefix → null (caller answers 404). */
export function classifyId(q: string): SupportIdKind | null {
  if (q.startsWith("site_")) return "site";
  if (q.startsWith("scan_")) return "scan";
  if (q.startsWith("job_")) return "scan_job";
  if (q.startsWith("pjob_")) return "pull_job";
  if (q.startsWith("env_")) return "envelope";
  return null;
}

/** Any security event = something already refused/suspicious;
 *  forge-rejected is the compromise class → P1. Scan failure or a
 *  conflict on an otherwise quiet site → P2; everything else P3. */
export function severityFor(card: {
  securityEvents: { eventType: string }[];
  latestScanStatus: string | null;
  stale: boolean;
}): SupportSeverity {
  if (card.securityEvents.some((e) => e.eventType === "job_forge_rejected"))
    return "P1";
  if (
    card.securityEvents.length > 0 ||
    card.latestScanStatus === "failed"
  )
    return "P2";
  return "P3";
}

export interface SupportCard {
  query: string;
  kind: SupportIdKind;
  severity: SupportSeverity;
  site: { id: string; tenantId: string | null; hostname: string | null; environment: string; status: string } | null;
  consents: { kind: string; status: string; revokedAt: string | null }[];
  scanJobs: {
    id: string; scanId: string; status: string;
    correlationId: string | null; error: string | null;
    probeFailures: number; createdAt: string; finishedAt: string | null;
  }[];
  pullJob: {
    id: string; probeId: string; status: string;
    leaseGeneration: number; reclaimCount: number;
    scanId: string | null; correlationId: string | null;
    createdAt: string; completedAt: string | null;
  } | null;
  securityEvents: {
    id: string; eventType: string; jobId: string | null;
    leaseGeneration: number | null; principal: string; createdAt: string;
  }[];
  evidence: { count: number; provenance: Record<string, number>; receivedAtMax: string | null };
}

export async function buildSupportCard(
  deps: SupportDeps,
  q: string,
): Promise<SupportCard | null> {
  const kind = classifyId(q);
  if (!kind) return null;

  // resolve the queried id → its site id
  let siteId: string | null = null;
  let pullJob: SupportCard["pullJob"] = null;
  if (kind === "site") siteId = q;
  else if (kind === "scan") {
    const j = await deps.scanJobs.byScanId(q);
    siteId = j?.siteId ?? null;
  } else if (kind === "scan_job") {
    const j = await deps.scanJobs.byId(q);
    siteId = j?.siteId ?? null;
  } else if (kind === "pull_job") {
    const j = deps.pullJobs ? await deps.pullJobs.byId(q) : null;
    if (j) {
      siteId = j.siteId;
      pullJob = {
        id: j.id, probeId: j.probeId, status: j.status,
        leaseGeneration: j.leaseGeneration, reclaimCount: j.reclaimCount,
        scanId: j.scanId, correlationId: j.correlationId,
        createdAt: j.createdAt, completedAt: j.completedAt,
      };
    }
  } else if (kind === "envelope") {
    const e = await deps.evidence.byId(q);
    siteId = e?.siteId ?? null;
  }
  if (!siteId) return null;

  const site = await deps.registryStores.sites.byId(siteId);
  if (!site) return null;
  // site rows carry customerId only — tenant resolves one hop up
  const customer = await deps.registryStores.customers.byId(site.customerId);
  const domains = await deps.registryStores.domains.forSite(siteId);
  const primary = domains.find((d) => d.isPrimary)?.hostname ?? null;

  const consents = await deps.consent.forSite(siteId);
  const jobs = (await deps.scanJobs.forSite(siteId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 10);
  const events = deps.securityEvents
    ? await deps.securityEvents.forSite(siteId)
    : [];
  const envelopes = await deps.evidence.forSite(siteId);
  const provenance: Record<string, number> = {};
  let receivedAtMax: string | null = null;
  for (const e of envelopes) {
    provenance[e.provenance] = (provenance[e.provenance] ?? 0) + 1;
    if (!receivedAtMax || e.receivedAt > receivedAtMax) receivedAtMax = e.receivedAt;
  }
  const latestJob = jobs[0] ?? null;
  const cardBase = {
    securityEvents: events,
    latestScanStatus: latestJob?.status ?? null,
    stale:
      receivedAtMax !== null &&
      Date.now() - Date.parse(receivedAtMax) > 30 * 86_400_000,
  };

  return {
    query: q,
    kind,
    severity: severityFor(cardBase),
    site: {
      id: site.id,
      tenantId: customer?.tenantId ?? null,
      hostname: primary,
      environment: site.environment,
      status: site.status,
    },
    consents: consents.map((c) => ({
      kind: c.kind, status: c.status, revokedAt: c.revokedAt,
    })),
    scanJobs: jobs.map((j) => ({
      id: j.id, scanId: j.scanId, status: j.status,
      correlationId: j.correlationId, error: j.error,
      probeFailures: j.probeFailures,
      createdAt: j.createdAt, finishedAt: j.finishedAt,
    })),
    pullJob,
    securityEvents: events.map((e) => ({
      id: e.id, eventType: e.eventType, jobId: e.jobId,
      leaseGeneration: e.leaseGeneration, principal: e.principal,
      createdAt: e.createdAt,
    })),
    evidence: { count: envelopes.length, provenance, receivedAtMax },
  };
}
