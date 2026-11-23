// EPIC-262 (SLICE-262-3): db-first evidence store selection (same
// pick convention as registry db-stores). `intelEvidence` arrives with
// the next published @agentbadge/database; until then the field is
// absent → shared memory fallback.

import type { Database } from "@agentbadge/database";
import { createMemoryIntelEvidenceStore } from "./store";
import type { IntelEvidenceStore } from "./store";

export type IntelEvidenceRepository = Omit<IntelEvidenceStore, "backend">;

let sharedMemoryStore: IntelEvidenceStore | undefined;

export function pickIntelEvidenceStore(
  db: Database | { intelEvidence?: IntelEvidenceRepository | null },
): IntelEvidenceStore {
  const repos = "intelEvidence" in db ? db.intelEvidence : undefined;
  if (repos) {
    return { backend: "postgres", ...repos };
  }
  return (sharedMemoryStore ??= createMemoryIntelEvidenceStore());
}
