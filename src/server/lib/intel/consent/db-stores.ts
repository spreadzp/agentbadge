// EPIC-262 (SLICE-262-8): db-first store selection — adapter
// narrows the package's loose record (kind: string) back to the
// ConsentKind union at the boundary; writers only ever produce the
// union values.

import type { Database } from "@agentbadge/database";
import { createMemoryIntelConsentStore } from "./memory";
import type { IntelConsentStore } from "./store";
import type {
  ConsentKind,
  ConsentPrincipal,
  ConsentStatus,
  IntelConsent,
} from "./types";

interface ConsentRepoRecord {
  id: string;
  siteId: string;
  kind: string;
  status: string;
  grantedByPrincipal: string;
  grantedById: string;
  grantedAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntelConsentRepository {
  upsert(c: ConsentRepoRecord): Promise<ConsentRepoRecord>;
  byScope(siteId: string, kind: string): Promise<ConsentRepoRecord | null>;
  forSite(siteId: string): Promise<ConsentRepoRecord[]>;
}

const fromRecord = (r: ConsentRepoRecord): IntelConsent => ({
  ...r,
  kind: r.kind as ConsentKind,
  status: r.status as ConsentStatus,
  grantedByPrincipal: r.grantedByPrincipal as ConsentPrincipal,
});

const adapt = (repo: IntelConsentRepository): IntelConsentStore => {
  // SLICE-262-23 — the package has no consent-events table yet
  // (needs @agentbadge/database ≥0.6.33): keep a process-local
  // list so history works warm-path; cold restart loses it, same
  // documented gap as the scanId→jobId index in 262-28.
  const events: import("./types").IntelConsentEvent[] = [];
  return {
    backend: "postgres",
    upsert: async (c) => fromRecord(await repo.upsert(c)),
    byScope: async (siteId, kind) => {
      const r = await repo.byScope(siteId, kind);
      return r ? fromRecord(r) : null;
    },
    forSite: async (siteId) =>
      (await repo.forSite(siteId)).map(fromRecord),
    appendEvent: async (e) => {
      events.push(e);
      return e;
    },
    eventsForSite: async (siteId) =>
      events.filter((e) => e.siteId === siteId),
  };
};

let sharedMemoryStore: IntelConsentStore | undefined;

export function pickIntelConsentStore(
  db: Database | { intelConsent?: IntelConsentRepository | null },
): IntelConsentStore {
  const repo = "intelConsent" in db ? db.intelConsent : undefined;
  if (repo) return adapt(repo);
  return (sharedMemoryStore ??= createMemoryIntelConsentStore());
}
