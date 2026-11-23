import type { IntelConsent } from "./types";
import type { IntelConsentStore } from "./store";

export function createMemoryIntelConsentStore(): IntelConsentStore {
  const rows = new Map<string, IntelConsent>(); // `${siteId}:${kind}`
  return {
    backend: "memory",
    async upsert(c) {
      rows.set(`${c.siteId}:${c.kind}`, c);
      return c;
    },
    async byScope(siteId, kind) {
      return rows.get(`${siteId}:${kind}`) ?? null;
    },
    async forSite(siteId) {
      return [...rows.values()].filter((c) => c.siteId === siteId);
    },
  };
}
