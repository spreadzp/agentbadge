// EPIC-262 (SLICE-262-2): db-first store selection (request-inbox
// pattern). The `intelRegistry` group arrives with the next published
// @agentbadge/database (contract models already committed there); until
// then the field is absent and we fall back to the shared memory impl.

import { createMemoryIntelRegistry } from "./memory";
import type { IntelRegistryStores } from "./store";

// Minimal structural type — satisfied by the @agentbadge/database
// repository group once published (and by mocks today).
export type IntelRegistryRepositories = Omit<IntelRegistryStores, "backend">;

let sharedMemoryStores: IntelRegistryStores | undefined;

export function pickIntelRegistryStores(db: {
  intelRegistry?: IntelRegistryRepositories | null;
}): IntelRegistryStores {
  if (db.intelRegistry) {
    return { backend: "postgres", ...db.intelRegistry };
  }
  return (sharedMemoryStores ??= createMemoryIntelRegistry());
}
