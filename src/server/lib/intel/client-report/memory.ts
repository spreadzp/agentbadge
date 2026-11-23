// EPIC-262 (SLICE-262-11): memory client-report store.
import type { ClientReport, IntelClientReportStore } from "./types";

export function createMemoryIntelClientReportStore(): IntelClientReportStore {
  const rows = new Map<string, ClientReport>();
  return {
    async insert(r) {
      rows.set(r.id, r);
      return r;
    },
    async byId(id) {
      return rows.get(id) ?? null;
    },
    async update(r) {
      if (!rows.has(r.id)) throw new Error(`client report ${r.id} vanished mid-update`);
      rows.set(r.id, r);
      return r;
    },
    async forSite(siteId) {
      return [...rows.values()].filter((r) => r.siteId === siteId);
    },
    async latestBeforePeriod(siteId, period) {
      const priors = [...rows.values()].filter(
        (r) => r.siteId === siteId && r.period < period,
      );
      priors.sort((a, b) => (a.period < b.period ? 1 : -1));
      return priors[0] ?? null;
    },
  };
}
