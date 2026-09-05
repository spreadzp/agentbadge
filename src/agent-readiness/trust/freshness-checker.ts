/**
 * SLICE-102-6: Freshness checker for Trust Snapshot.
 *
 * Computes age of snapshot timestamp and compares against a configurable window.
 */

export interface FreshnessResult {
  fresh: boolean;
  ageDays: number;
  expires_in_days: number;
}

/**
 * Check if a timestamp is within the freshness window.
 *
 * @param timestamp - ISO 8601 timestamp string (e.g. "2026-09-04T21:55:00Z")
 * @param windowDays - Maximum age in days (default 30)
 * @returns Freshness result with age, remaining days, and fresh flag
 */
export function checkFreshness(timestamp: string, windowDays: number = 30): FreshnessResult {
  const snapshotTime = new Date(timestamp);
  const now = new Date();

  const ageMs = now.getTime() - snapshotTime.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const expires_in_days = windowDays - ageDays;

  return {
    fresh: ageDays <= windowDays,
    ageDays,
    expires_in_days,
  };
}
