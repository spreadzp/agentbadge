// SLICE-176-2: rolling-window metrics extracted from ledger.ts
// (300-line guard). Two boundary semantics:
//   windowUsage — 155-2 caps math, boundary INCLUSIVE (entry at exactly
//     now−window still counts);
//   windowCount — 176-2 velocity, boundary EXCLUSIVE ("not more than N
//     in the last hour") + entry count alongside the sum.
//
// Both scan reserved+settled entries — released/failed/denied entries
// free their amount and do not count.

import type { SpendLedger } from "./ledger";

/** Sum of reserved+settled amounts for wallet within `windowSec` (rolling). */
export async function windowUsage(
  ledger: SpendLedger,
  wallet: string,
  windowSec: number,
  now = Date.now(),
): Promise<{ used: number; oldestAt?: number }> {
  const cutoff = now - windowSec * 1000;
  let used = 0;
  let oldestAt: number | undefined;
  for (const e of await ledger.listByWallet(wallet)) {
    if (e.state !== "reserved" && e.state !== "settled") continue;
    if (e.at < cutoff) continue;
    used += e.amountUsd;
    if (oldestAt === undefined || e.at < oldestAt) oldestAt = e.at;
  }
  return { used, ...(oldestAt !== undefined ? { oldestAt } : {}) };
}

/**
 * SLICE-176-2: velocity metrics — count + sum of reserved+settled
 * entries inside a rolling window. Unlike `windowUsage`, the boundary
 * is EXCLUSIVE: an entry at exactly `now − windowSec` is not counted
 * (hourly cap semantics — "not more than N in the last hour").
 */
export async function windowCount(
  ledger: SpendLedger,
  wallet: string,
  windowSec: number,
  now = Date.now(),
): Promise<{ count: number; used: number; oldestAt?: number }> {
  const cutoff = now - windowSec * 1000;
  let count = 0;
  let used = 0;
  let oldestAt: number | undefined;
  for (const e of await ledger.listByWallet(wallet)) {
    if (e.state !== "reserved" && e.state !== "settled") continue;
    if (e.at <= cutoff) continue;
    count += 1;
    used += e.amountUsd;
    if (oldestAt === undefined || e.at < oldestAt) oldestAt = e.at;
  }
  return { count, used, ...(oldestAt !== undefined ? { oldestAt } : {}) };
}
