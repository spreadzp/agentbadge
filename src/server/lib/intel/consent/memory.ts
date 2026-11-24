import type { IntelConsent, IntelConsentEvent } from "./types";
import type { IntelConsentStore } from "./store";

export function createMemoryIntelConsentStore(): IntelConsentStore {
  const rows = new Map<string, IntelConsent>(); // `${siteId}:${kind}`
  const events: IntelConsentEvent[] = [];
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
    async appendEvent(e) {
      events.push(e);
      return e;
    },
    async eventsForSite(siteId) {
      return events.filter((e) => e.siteId === siteId);
    },
  };
}
