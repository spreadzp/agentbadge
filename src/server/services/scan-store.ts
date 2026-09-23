/**
 * SLICE-145-2: Scan Store service (D9).
 *
 * Write-behind persistence for `/total-scan` results into the `ScanResult`
 * model (`packages/database`). `record()` is fire-and-forget — a DB failure
 * never breaks the scan response. `latest()` reads through
 * `getDatabase().scanResults`, which transparently falls back to
 * `InMemoryScanResultStore` when `DATABASE_ENABLED` is unset (EPIC-143
 * contract: zero behavior change).
 *
 * `normalizeDomain` lives here (not in `profile-store`) so the store can
 * normalize keys internally without a profile-store ↔ scan-store import
 * cycle. `profile-store` re-exports it for existing consumers.
 */

import {
  InMemoryScanResultStore,
  type ScanResult,
  type ScanResultStore,
} from "@agentbadge/database";

import { getDatabase } from "../lib/database";

/** Payload accepted by `recordScanResult` — maps onto the ScanResult row. */
export interface RecordScanInput {
  /** Domain in any form — normalized internally before write. */
  domain: string;
  /** Full scanned URL (as normalized by the route). */
  url: string;
  /** Overall readiness score, when computed. */
  score?: number | null;
  /** JSON payload — the `ScanData` blob consumed by profile endpoints. */
  report: unknown;
  /** Ruleset version that produced the report. */
  rulesetVersion?: string | null;
}

// Own in-memory fallback (D9): used when `getDatabase()` itself cannot be
// built — e.g. env config fails to load in tests/minimal environments.
// profile-store was a pure Map before this slice and must keep working
// with zero env.
let fallbackStore: ScanResultStore | null = null;

function store(): ScanResultStore {
  try {
    return getDatabase().scanResults;
  } catch {
    return (fallbackStore ??= new InMemoryScanResultStore());
  }
}

/** Test hook — drop the fallback store (pair with `resetDatabaseForTests`). */
export function resetScanStoreForTests(): void {
  fallbackStore = null;
}

/**
 * Append a scan result row (D5: append-only, never upsert).
 * Fire-and-forget: returns void, swallows errors — the caller's response
 * must never depend on persistence succeeding.
 */
export function recordScanResult(input: RecordScanInput): void {
  const row = {
    domain: normalizeDomain(input.domain),
    url: input.url,
    score: input.score ?? null,
    report: input.report as ScanResult["report"],
    rulesetVersion: input.rulesetVersion ?? null,
  };
  void store()
    .create(row)
    .catch(() => {
      // DB write failed (e.g. unmigrated/unreachable) — degrade to the
      // in-memory fallback so profile-store keeps working. Persistence is
      // best-effort; the scan response was already streamed.
      void (fallbackStore ??= new InMemoryScanResultStore())
        .create(row)
        .catch(() => {});
    });
}

/**
 * Latest scan row for a domain (normalized). `null` when never scanned.
 * Reads PG when enabled, the in-memory store otherwise.
 */
export async function latestScanResult(domain: string): Promise<ScanResult | null> {
  const d = normalizeDomain(domain);
  try {
    return await store().latestByDomain(d);
  } catch {
    // DB read failed — degrade to the in-memory fallback (zero behavior
    // change: profile endpoints must not 503 on storage issues).
    return (fallbackStore ??= new InMemoryScanResultStore()).latestByDomain(d);
  }
}

/**
 * Normalize a domain: strip protocol, path, port; strip www. prefix.
 * Canonical key for `ScanResult.domain` and all profile-store lookups.
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
