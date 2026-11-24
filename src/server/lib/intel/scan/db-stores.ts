// EPIC-262 (SLICE-262-6): db-first scan-job store selection (same
// pick convention as registry/evidence/entitlement). Adapter narrows
// the package's loose record types at the boundary (status: string →
// ScanJobStatus union; report: unknown → IntelReport).

import type { Database } from "@agentbadge/database";
import { createMemoryScanJobStore } from "./memory";
import type { IntelScanJobStore } from "./store";
import type { ScanJob, ScanJobStatus } from "./types";
import type { IntelReport } from "../report/schema";

interface ScanJobRepoRecord {
  id: string;
  siteId: string;
  tenantId: string;
  scanId: string;
  status: string;
  baseUrl: string;
  probeFailures: number;
  probeTotal: number;
  error: string | null;
  reportId: string | null;
  report: unknown | null;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface ScanJobRepository {
  insert(j: ScanJobRepoRecord): Promise<ScanJobRepoRecord>;
  byId(id: string): Promise<ScanJobRepoRecord | null>;
  byScanId(scanId: string): Promise<ScanJobRepoRecord | null>;
  update(j: ScanJobRepoRecord): Promise<ScanJobRepoRecord>;
  forSite(siteId: string): Promise<ScanJobRepoRecord[]>;
}

const fromRecord = (r: ScanJobRepoRecord): ScanJob => ({
  ...r,
  correlationId: r.correlationId ?? null,
  status: r.status as ScanJobStatus,
  report: (r.report ?? null) as IntelReport | null,
});

const toRecord = (j: ScanJob): ScanJobRepoRecord => ({
  id: j.id,
  siteId: j.siteId,
  tenantId: j.tenantId,
  scanId: j.scanId,
  status: j.status,
  baseUrl: j.baseUrl,
  probeFailures: j.probeFailures,
  probeTotal: j.probeTotal,
  error: j.error,
  reportId: j.reportId,
  report: j.report,
  correlationId: j.correlationId,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
  finishedAt: j.finishedAt,
});

const adapt = (repo: ScanJobRepository): IntelScanJobStore => ({
  insert: async (j) => fromRecord(await repo.insert(toRecord(j))),
  byId: async (id) => {
    const r = await repo.byId(id);
    return r ? fromRecord(r) : null;
  },
  byScanId: async (scanId) => {
    const r = await repo.byScanId(scanId);
    return r ? fromRecord(r) : null;
  },
  update: async (j) => fromRecord(await repo.update(toRecord(j))),
  forSite: async (siteId) =>
    (await repo.forSite(siteId)).map(fromRecord),
});

let shared: IntelScanJobStore | undefined;

export function pickIntelScanJobStore(
  db: Database | { intelScanJobs?: ScanJobRepository | null },
): IntelScanJobStore {
  const repo = "intelScanJobs" in db ? db.intelScanJobs : undefined;
  if (repo) return adapt(repo);
  return (shared ??= createMemoryScanJobStore());
}
