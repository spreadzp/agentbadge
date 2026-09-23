import type { ScanReport } from "../../agent-readiness/report-formatter";
import type { Assertion } from "../../agent-readiness/rule-engine/assertion-builder";
import type { ScoreResult } from "../../agent-readiness/scoring/scoring-types";
import { resetDatabaseForTests } from "../lib/database";
import {
  latestScanResult,
  recordScanResult,
  resetScanStoreForTests,
} from "../services/scan-store";

/**
 * SLICE-101-7: Profile Store Adapter.
 * SLICE-145-2: delegates persistence to `services/scan-store` — ScanResult
 * rows in PG when `DATABASE_ENABLED`, in-memory fallback otherwise.
 *
 * `normalizeDomain` is re-exported from scan-store (its canonical home) so
 * existing imports from this module keep working.
 */

export { normalizeDomain } from "../services/scan-store";

export interface ScanData {
  scanReport: ScanReport;
  assertions: Assertion[];
  scoreResult?: ScoreResult;
  reportId?: string;
}

/**
 * Store scan data — fire-and-forget append to the ScanResult store.
 * Synchronously visible when the in-memory fallback is active.
 */
export function cacheScanData(domain: string, data: ScanData): void {
  recordScanResult({
    domain,
    url: data.scanReport?.url ?? domain,
    score: data.scanReport?.score ?? null,
    report: data,
  });
}

/**
 * Get the latest scan data for a domain.
 * Returns null if domain has never been scanned.
 */
export async function getLatestScanForDomain(domain: string): Promise<ScanData | null> {
  const row = await latestScanResult(domain);
  return row ? (row.report as ScanData) : null;
}

/**
 * Clear stored scans (test helper) — drops the database singleton so the
 * next access rebuilds a fresh in-memory store.
 */
export function clearScanCache(): void {
  resetDatabaseForTests();
  resetScanStoreForTests();
}
