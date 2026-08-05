export interface TtlResult {
  stale: boolean;
  ageDays: number;
  ttlDays: number;
  expiresAt: string;
}

export function checkStaleness(scannedAt: string, ttlDays: number = 7): TtlResult {
  const scanned = new Date(scannedAt).getTime();
  const now = Date.now();
  const ageMs = now - scanned;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const expiresAtMs = scanned + ttlMs;
  const expiresAt = new Date(expiresAtMs).toISOString();

  return {
    stale: ageMs > ttlMs,
    ageDays,
    ttlDays,
    expiresAt,
  };
}
