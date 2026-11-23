// EPIC-262 (SLICE-262-2): db-first store selection (request-inbox
// pattern). The `intelRegistry` group arrives with the next published
// @agentbadge/database (contract models already committed there); until
// then the field is absent and we fall back to the shared memory impl.

import type { Database } from "@agentbadge/database";
import { createMemoryIntelRegistry } from "./memory";
import type { IntelRegistryStores } from "./store";

// Minimal structural type — satisfied by the @agentbadge/database
// repository group once published (and by mocks today). The union
// accepts the installed Database facade (field absent → memory) AND
// the post-publish shape without a type-level pick.
export type IntelRegistryRepositories = Omit<IntelRegistryStores, "backend">;

let sharedMemoryStores: IntelRegistryStores | undefined;

export function pickIntelRegistryStores(
  db: Database | { intelRegistry?: IntelRegistryRepositories | null },
): IntelRegistryStores {
  const repos =
    "intelRegistry" in db ? db.intelRegistry : undefined;
  if (repos) {
    return { backend: "postgres", ...repos };
  }
  return (sharedMemoryStores ??= createMemoryIntelRegistry());
}
