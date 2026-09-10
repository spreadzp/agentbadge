/**
 * SLICE-101-9: Auto-refresh — generates and caches a KnowledgeProfile
 * from the latest scan data for a domain.
 */

import { buildProfile } from "../../agent-readiness/profile/profile-builder";
import { cacheScanData, getLatestScanForDomain, normalizeDomain, type ScanData } from "./profile-store";
import type { KnowledgeProfile } from "../../agent-readiness/profile/profile-schema";

export interface RefreshResult {
  success: boolean;
  domain: string;
  profile?: KnowledgeProfile;
  error?: string;
}

/**
 * Generate a KnowledgeProfile from the latest scan data for a domain
 * and cache it in the profile store.
 *
 * If no scan data exists for the domain, returns { success: false }.
 */
export async function refreshProfileForDomain(domain: string): Promise<RefreshResult> {
  const normalized = normalizeDomain(domain);

  try {
    const scanData = await getLatestScanForDomain(normalized);
    if (!scanData) {
      return { success: false, domain: normalized, error: "No scan data found for domain" };
    }

    const profile = buildProfile({
      scanReport: scanData.scanReport,
      assertions: scanData.assertions,
      scoreResult: scanData.scoreResult,
      reportId: scanData.reportId,
    });

    // Re-cache with updated profile (scan data stays the same)
    cacheScanData(normalized, scanData);

    return { success: true, domain: normalized, profile };
  } catch (err) {
    return { success: false, domain: normalized, error: String(err) };
  }
}

/**
 * Store scan data and generate a cached profile from it.
 * Called after a scan completes.
 */
export async function storeAndRefresh(
  domain: string,
  scanData: ScanData,
): Promise<RefreshResult> {
  const normalized = normalizeDomain(domain);
  cacheScanData(normalized, scanData);

  try {
    const profile = buildProfile({
      scanReport: scanData.scanReport,
      assertions: scanData.assertions,
      scoreResult: scanData.scoreResult,
      reportId: scanData.reportId,
    });

    return { success: true, domain: normalized, profile };
  } catch (err) {
    return { success: false, domain: normalized, error: String(err) };
  }
}
