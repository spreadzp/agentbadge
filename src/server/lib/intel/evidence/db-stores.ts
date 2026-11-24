// EPIC-262 (SLICE-262-3): db-first evidence store selection —
// adapter narrows the package's loose record (provenance: string,
// envelope: unknown) back to the typed envelope record at the
// boundary; writers only ever produce the enum values.

import type { Database } from "@agentbadge/database";
import { createMemoryIntelEvidenceStore } from "./store";
import type {
  IntelEnvelopeRecord,
  IntelEvidenceStore,
} from "./store";
import type { CanonicalEnvelope } from "./envelope";

interface EnvelopeRepoRecord {
  id: string;
  schemaVersion: string;
  siteId: string;
  scanId: string;
  collectorId: string;
  provenance: string;
  dedupeHash: string;
  receivedAt: string;
  expiresAt: string | null;
  envelope: unknown;
}

export interface IntelEvidenceRepository {
  insert(r: EnvelopeRepoRecord): Promise<EnvelopeRepoRecord>;
  byDedupeHash(dedupeHash: string): Promise<EnvelopeRepoRecord | null>;
  byId(id: string): Promise<EnvelopeRepoRecord | null>;
  forSite(siteId: string): Promise<EnvelopeRepoRecord[]>;
  forScan(siteId: string, scanId: string): Promise<EnvelopeRepoRecord[]>;
  sweep(nowIso: string): Promise<number>;
}

const fromRecord = (r: EnvelopeRepoRecord): IntelEnvelopeRecord => ({
  ...r,
  provenance: r.provenance as CanonicalEnvelope["provenance"],
  envelope: r.envelope as CanonicalEnvelope,
});

const adapt = (repo: IntelEvidenceRepository): IntelEvidenceStore => ({
  backend: "postgres",
  insert: async (r) => fromRecord(await repo.insert(r)),
  byDedupeHash: async (h) => {
    const r = await repo.byDedupeHash(h);
    return r ? fromRecord(r) : null;
  },
  byId: async (id) => {
    const r = await repo.byId(id);
    return r ? fromRecord(r) : null;
  },
  forSite: async (siteId) =>
    (await repo.forSite(siteId)).map(fromRecord),
  forScan: async (siteId, scanId) =>
    (await repo.forScan(siteId, scanId)).map(fromRecord),
  sweep: (nowIso) => repo.sweep(nowIso),
});

let sharedMemoryStore: IntelEvidenceStore | undefined;

export function pickIntelEvidenceStore(
  db: Database | { intelEvidence?: IntelEvidenceRepository | null },
): IntelEvidenceStore {
  const repo = "intelEvidence" in db ? db.intelEvidence : undefined;
  if (repo) return adapt(repo);
  return (sharedMemoryStore ??= createMemoryIntelEvidenceStore());
}
