// EPIC-262 (SLICE-262-8): db-first store selection — the
// `intelConsent` group arrives with the published @agentbadge/database
// (contract model committed there); until then the field is absent
// and we fall back to the shared memory impl.

import type { Database } from "@agentbadge/database";
import { createMemoryIntelConsentStore } from "./memory";
import type { IntelConsentStore } from "./store";

export type IntelConsentRepository = Omit<IntelConsentStore, "backend">;

let sharedMemoryStore: IntelConsentStore | undefined;

export function pickIntelConsentStore(
  db: Database | { intelConsent?: IntelConsentRepository | null },
): IntelConsentStore {
  const repo = "intelConsent" in db ? db.intelConsent : undefined;
  if (repo) {
    return { backend: "postgres", ...repo };
  }
  return (sharedMemoryStore ??= createMemoryIntelConsentStore());
}
