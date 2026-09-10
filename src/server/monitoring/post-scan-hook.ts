/**
 * SLICE-101-9: Post-scan hook — triggers profile refresh after a scan completes.
 *
 * Non-blocking: profile generation failure does NOT fail the scan.
 * If EPIC-99 monitoring is not available, this is a no-op (graceful degradation).
 */

import { refreshProfileForDomain, storeAndRefresh } from "../profile/auto-refresh";
import type { ScanData } from "../profile/profile-store";

export interface ScanCompleteEvent {
  domain: string;
  scanData: ScanData;
}

/**
 * Hook called after a scan completes.
 * Triggers profile refresh asynchronously — does not throw.
 */
export async function onScanComplete(event: ScanCompleteEvent): Promise<void> {
  try {
    await storeAndRefresh(event.domain, event.scanData);
  } catch (err) {
    // Profile generation failure is non-fatal — log and continue
    console.error(`[post-scan-hook] Profile refresh failed for ${event.domain}: ${err}`);
  }
}

/**
 * Hook called after a monitoring scan completes (EPIC-99).
 * If monitoring store is not available, this is a no-op.
 */
export async function onMonitoringScanComplete(
  domain: string,
  scanData: ScanData | null,
): Promise<void> {
  if (!scanData) return;

  try {
    await refreshProfileForDomain(domain);
  } catch (err) {
    console.error(`[post-scan-hook] Monitoring profile refresh failed for ${domain}: ${err}`);
  }
}
