// EPIC-262 (SLICE-262-11): db-first client-report store selection
// (same pick convention as scan-job store). `intelClientReports`
// ships with the next published @agentbadge/database; until then →
// shared memory.

import type { Database } from "@agentbadge/database";
import { createMemoryIntelClientReportStore } from "./memory";
import type {
  ClientReport,
  ClientReportCanonical,
  ClientReportDelta,
  ClientReportStatus,
  EditorialRevision,
  IntelClientReportStore,
} from "./types";

// The published package repo types JSON columns loosely
// (status: string, canonical: unknown). This adapter narrows them
// back to the domain record at the boundary — writers only ever
// produce the union values (adapter = seam, not trust boundary).
interface RepoRecord {
  id: string;
  siteId: string;
  tenantId: string;
  period: string;
  status: string;
  canonical: unknown;
  delta: unknown | null;
  editorial: unknown;
  editorialHistory: unknown;
  approvedBy: string | null;
  sentBy: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface RepoStore {
  insert(r: RepoRecord): Promise<RepoRecord>;
  byId(id: string): Promise<RepoRecord | null>;
  update(r: RepoRecord): Promise<RepoRecord>;
  forSite(siteId: string): Promise<RepoRecord[]>;
  latestBeforePeriod(siteId: string, period: string): Promise<RepoRecord | null>;
}

const fromRecord = (r: RepoRecord): ClientReport => ({
  ...r,
  status: r.status as ClientReportStatus,
  canonical: r.canonical as ClientReportCanonical,
  delta: (r.delta ?? null) as ClientReportDelta | null,
  editorial: r.editorial as EditorialRevision,
  editorialHistory: r.editorialHistory as EditorialRevision[],
});

const adapt = (repo: RepoStore): IntelClientReportStore => ({
  insert: async (r) => fromRecord(await repo.insert(r)),
  byId: async (id) => {
    const r = await repo.byId(id);
    return r ? fromRecord(r) : null;
  },
  update: async (r) => fromRecord(await repo.update(r)),
  forSite: async (siteId) =>
    (await repo.forSite(siteId)).map(fromRecord),
  latestBeforePeriod: async (siteId, period) => {
    const r = await repo.latestBeforePeriod(siteId, period);
    return r ? fromRecord(r) : null;
  },
});

let shared: IntelClientReportStore | undefined;

export function pickIntelClientReportStore(
  db: Database | { intelClientReports?: RepoStore | null },
): { store: IntelClientReportStore; backend: "postgres" | "memory" } {
  const repo = "intelClientReports" in db ? db.intelClientReports : undefined;
  if (repo) return { store: adapt(repo), backend: "postgres" };
  return { store: (shared ??= createMemoryIntelClientReportStore()), backend: "memory" };
}
