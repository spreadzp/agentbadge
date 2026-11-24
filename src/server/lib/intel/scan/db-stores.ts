// EPIC-262 (SLICE-262-6): db-first scan-job store selection (same
// pick convention as registry/evidence/entitlement). Adapter narrows
// the package's loose record types at the boundary (status: string →
// ScanJobStatus union; report: unknown → IntelReport).
// KNOWN GAP (until the next @agentbadge/database bump): the package
// record has no `correlationId` column — PG reads return null, and
// `byScanId` falls back to a forSite scan (O(n) per site, bounded).

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
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface ScanJobRepository {
  insert(j: ScanJobRepoRecord): Promise<ScanJobRepoRecord>;
  byId(id: string): Promise<ScanJobRepoRecord | null>;
  update(j: ScanJobRepoRecord): Promise<ScanJobRepoRecord>;
  forSite(siteId: string): Promise<ScanJobRepoRecord[]>;
}

const fromRecord = (r: ScanJobRepoRecord): ScanJob => ({
  ...r,
  // package record has no correlationId column yet — reads degrade
  // honestly to null rather than faking a value
  correlationId: null,
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
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
  finishedAt: j.finishedAt,
});

const adapt = (repo: ScanJobRepository): IntelScanJobStore => {
  // The published repo (0.6.32) has no scanId query — the table is
  // only reachable by id/siteId. Process-local scanId→jobId index,
  // warmed by every write/read through this adapter: honest on the
  // warm path (all jobs go through here); a cold miss after restart
  // answers null like an unknown id, never a wrong job. Real
  // byScanId lands with the next package bump.
  const scanIndex = new Map<string, string>();
  const track = (j: ScanJob) => {
    scanIndex.set(j.scanId, j.id);
    return j;
  };
  return {
    insert: async (j) => track(fromRecord(await repo.insert(toRecord(j)))),
    byId: async (id) => {
      const r = await repo.byId(id);
      return r ? track(fromRecord(r)) : null;
    },
    byScanId: async (scanId) => {
      const id = scanIndex.get(scanId);
      if (!id) return null;
      const r = await repo.byId(id);
      return r ? fromRecord(r) : null;
    },
    update: async (j) => track(fromRecord(await repo.update(toRecord(j)))),
    forSite: async (siteId) =>
      (await repo.forSite(siteId)).map((r) => track(fromRecord(r))),
  };
};

let shared: IntelScanJobStore | undefined;

export function pickIntelScanJobStore(
  db: Database | { intelScanJobs?: ScanJobRepository | null },
): IntelScanJobStore {
  const repo = "intelScanJobs" in db ? db.intelScanJobs : undefined;
  if (repo) return adapt(repo);
  return (shared ??= createMemoryScanJobStore());
}
