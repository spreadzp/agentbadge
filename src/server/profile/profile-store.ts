import type { ScanReport } from "../../agent-readiness/report-formatter";
import type { Assertion } from "../../agent-readiness/rule-engine/assertion-builder";
import type { ScoreResult } from "../../agent-readiness/scoring/scoring-types";

/**
 * SLICE-101-7: Profile Store Adapter.
 *
 * Retrieves the latest scan data for a domain.
 * Falls back to in-memory cache when EPIC-99 monitoring store is not available.
 */

export interface ScanData {
  scanReport: ScanReport;
  assertions: Assertion[];
  scoreResult?: ScoreResult;
  reportId?: string;
}

// In-memory cache: domain → latest scan data
const scanCache = new Map<string, ScanData>();

/**
 * Store scan data in the in-memory cache.
 */
export function cacheScanData(domain: string, data: ScanData): void {
  scanCache.set(normalizeDomain(domain), data);
}

/**
 * Get the latest scan data for a domain.
 * Returns null if domain has never been scanned.
 */
export async function getLatestScanForDomain(domain: string): Promise<ScanData | null> {
  const normalized = normalizeDomain(domain);
  return scanCache.get(normalized) ?? null;
}

/**
 * Clear the in-memory cache (for testing).
 */
export function clearScanCache(): void {
  scanCache.clear();
}

/**
 * Normalize a domain: strip protocol, path, port; strip www. prefix.
 */
export function normalizeDomain(input: string): string {
  let domain = input.trim();

  // Strip protocol
  domain = domain.replace(/^https?:\/\//, "");

  // Strip path
  domain = domain.split("/")[0];

  // Strip port
  domain = domain.split(":")[0];

  // Strip www.
  domain = domain.replace(/^www\./, "");

  return domain.toLowerCase();
}
