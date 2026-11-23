// EPIC-262 (SLICE-262-6): scan-job store contract.
import type { ScanJob } from "./types";

export interface IntelScanJobStore {
  backend?: string;
  insert(j: ScanJob): Promise<ScanJob>;
  byId(id: string): Promise<ScanJob | null>;
  update(j: ScanJob): Promise<ScanJob>;
  forSite(siteId: string): Promise<ScanJob[]>;
}
