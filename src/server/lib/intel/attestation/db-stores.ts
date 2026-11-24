// EPIC-262 (SLICE-262-37): db-first attestation store selection (same
// pick convention). Adapter maps the snake_case signed artifact to
// the package's flat camelCase record.
import type { Database } from "@agentbadge/database";
import { createMemoryAttestationStore } from "./memory";
import type { IntelAttestationStore } from "./store";
import type { IntelAttestation } from "./types";

interface AttestationRepoRecord {
  id: string;
  siteId: string;
  tenantId: string;
  reportId: string;
  scanId: string;
  contentHash: string;
  scores: unknown;
  ruleset: unknown;
  issued: string;
  validUntil: string;
  status: string;
  revokedAt: string | null;
  revokedReason: string | null;
  signature: unknown;
}

export interface AttestationRepository {
  insert(a: AttestationRepoRecord): Promise<AttestationRepoRecord>;
  byId(id: string): Promise<AttestationRepoRecord | null>;
  forSite(siteId: string): Promise<AttestationRepoRecord[]>;
  update(a: AttestationRepoRecord): Promise<AttestationRepoRecord>;
}

const fromRecord = (r: AttestationRepoRecord): IntelAttestation => ({
  schema_version: "intel-attestation/1",
  attestation_id: r.id,
  site_id: r.siteId,
  tenant_id: r.tenantId,
  report_id: r.reportId,
  scan_id: r.scanId,
  ruleset: r.ruleset as IntelAttestation["ruleset"],
  scores: r.scores as IntelAttestation["scores"],
  content_hash: r.contentHash as IntelAttestation["content_hash"],
  issued: r.issued,
  valid_until: r.validUntil,
  status: r.status as IntelAttestation["status"],
  revoked_at: r.revokedAt,
  revoked_reason: r.revokedReason,
  signature: r.signature as IntelAttestation["signature"],
});

const toRecord = (a: IntelAttestation): AttestationRepoRecord => ({
  id: a.attestation_id,
  siteId: a.site_id,
  tenantId: a.tenant_id,
  reportId: a.report_id,
  scanId: a.scan_id,
  contentHash: a.content_hash,
  scores: a.scores,
  ruleset: a.ruleset,
  issued: a.issued,
  validUntil: a.valid_until,
  status: a.status,
  revokedAt: a.revoked_at,
  revokedReason: a.revoked_reason,
  signature: a.signature,
});

const adapt = (repo: AttestationRepository): IntelAttestationStore => ({
  backend: "postgres",
  insert: async (a) => fromRecord(await repo.insert(toRecord(a))),
  byId: async (id) => {
    const r = await repo.byId(id);
    return r ? fromRecord(r) : null;
  },
  forSite: async (siteId) =>
    (await repo.forSite(siteId)).map(fromRecord),
  update: async (a) => fromRecord(await repo.update(toRecord(a))),
});

let shared: IntelAttestationStore | undefined;

export function pickIntelAttestationStore(
  db: Database | { intelAttestations?: AttestationRepository | null },
): IntelAttestationStore {
  const repo = "intelAttestations" in db ? db.intelAttestations : undefined;
  if (repo) return adapt(repo);
  return (shared ??= createMemoryAttestationStore());
}
