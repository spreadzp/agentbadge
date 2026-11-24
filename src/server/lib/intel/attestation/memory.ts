// EPIC-262 (SLICE-262-28): in-memory attestation store.
import type { IntelAttestation } from "./types";
import type { IntelAttestationStore } from "./store";

export function createMemoryAttestationStore(): IntelAttestationStore {
  const byId = new Map<string, IntelAttestation>();
  return {
    backend: "memory",
    async insert(a) {
      byId.set(a.attestation_id, a);
      return a;
    },
    async byId(id) {
      return byId.get(id) ?? null;
    },
    async forSite(siteId) {
      return [...byId.values()].filter((a) => a.site_id === siteId);
    },
    async update(a) {
      byId.set(a.attestation_id, a);
      return a;
    },
  };
}
