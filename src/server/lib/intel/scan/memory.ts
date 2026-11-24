// EPIC-262 (SLICE-262-6): in-memory scan-job store.
import type { ScanJob } from "./types";
import type { IntelScanJobStore } from "./store";

export function createMemoryScanJobStore(): IntelScanJobStore {
  const byId = new Map<string, ScanJob>();
  return {
    backend: "memory",
    async insert(j) {
      byId.set(j.id, j);
      return j;
    },
    async byId(id) {
      return byId.get(id) ?? null;
    },
    async byScanId(scanId) {
      return [...byId.values()].find((j) => j.scanId === scanId) ?? null;
    },
    async update(j) {
      byId.set(j.id, j);
      return j;
    },
    async forSite(siteId) {
      return [...byId.values()].filter((j) => j.siteId === siteId);
    },
  };
}
