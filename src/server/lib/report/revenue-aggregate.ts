/**
 * SLICE-242-11 (D-242-14): shared revenue aggregator — single source of
 * truth for "сколько заработали" over econ-ledger pay legs.
 *
 * `aggregatePayLegs` is a pure function over an iterable of ledger rows:
 * filter kind="pay" ∧ counterparty=PAY_TO ∧ at >= since → GROUP BY
 * day/endpoint. Used by BOTH consumers:
 *   - GET /api/ledger/revenue (242-9) — via `collectPayLegs` pager
 *     (listByAgent beforeLedgerSeq pages, newest-first, cap-bound)
 *   - ops digest business section (242-11) — reuses the EconomicEvent
 *     rows collectBusinessStats already scanned (no second pass).
 *
 * Amounts stay integer micro-USDC (bigint) until final format — no
 * float drift on the money path.
 */

import {
  fromMicros,
  toMicros,
  type EconLedgerStore,
} from "@agentbadge/database";

export const UNKNOWN_ENDPOINT = "unknown";
const PAGE_SIZE = 500;
const SCAN_CAP = 10_000;

/** Minimal row shape — satisfied by EconEventStored.event and orm rows. */
export interface PayLegRow {
  kind: string;
  counterparty?: string | null;
  amountUsdc?: string | null;
  at: string;
  payload?: unknown;
}

export interface RevenueBucket {
  count: number;
  micros: bigint;
}

export interface RevenueRollup {
  total: { count: number; usdc: string };
  /** Ascending day order. */
  byDay: { day: string; count: number; usdc: string }[];
  /** Sorted: count desc, then usdc desc. */
  byEndpoint: { endpoint: string; count: number; usdc: string }[];
}

/** payTo source: x402 treasury, falling back to the Circle seller. */
export function revenuePayTo(): string | undefined {
  return (
    process.env.X402_PAY_TO ?? process.env.CIRCLE_SELLER_ADDRESS ?? undefined
  );
}

/**
 * GROUP BY day/endpoint over pay legs to `payTo` since `sinceIso`.
 * Events without payload.endpoint land in the "unknown" bucket —
 * pre-0.1.4 events never carried it (legacy attribution gap).
 */
export function aggregatePayLegs(
  rows: Iterable<PayLegRow>,
  opts: { payTo: string; since: string },
): RevenueRollup {
  const payToLc = opts.payTo.toLowerCase();
  const total: RevenueBucket = { count: 0, micros: 0n };
  const byDay = new Map<string, RevenueBucket>();
  const byEndpoint = new Map<string, RevenueBucket>();
  const bump = (m: Map<string, RevenueBucket>, k: string, micros: bigint) => {
    const b = m.get(k) ?? { count: 0, micros: 0n };
    b.count++;
    b.micros += micros;
    m.set(k, b);
  };

  for (const e of rows) {
    const at = String(e.at);
    if (
      e.kind !== "pay" ||
      e.counterparty?.toLowerCase() !== payToLc ||
      at < opts.since
    ) {
      continue;
    }
    const micros = toMicros(e.amountUsdc);
    total.count++;
    total.micros += micros;
    bump(byDay, at.slice(0, 10), micros);
    const endpoint =
      (e.payload as { endpoint?: string } | undefined)?.endpoint ??
      UNKNOWN_ENDPOINT;
    bump(byEndpoint, endpoint, micros);
  }

  const fmt = (b: RevenueBucket) => ({
    count: b.count,
    usdc: fromMicros(b.micros),
  });

  return {
    total: fmt(total),
    byDay: [...byDay.entries()]
      .map(([day, b]) => ({ day, ...fmt(b) }))
      .sort((a, b2) => (a.day < b2.day ? -1 : 1)),
    byEndpoint: [...byEndpoint.entries()]
      .sort(
        ([, a], [, b]) =>
          b.count - a.count ||
          (b.micros > a.micros ? 1 : b.micros < a.micros ? -1 : 0),
      )
      .map(([endpoint, b]) => ({ endpoint, ...fmt(b) })),
  };
}

/**
 * Paged pay-leg fetch for the revenue API: listByAgent newest-first
 * with a beforeLedgerSeq cursor. Stops on exhaustion, a fully
 * out-of-window page (append order ≈ event time), or the scan cap —
 * the cap sets `truncated` so callers surface an honest flag.
 */
export async function collectPayLegs(
  ledger: Pick<EconLedgerStore, "listByAgent">,
  opts: { payTo: string; since: string; cap?: number },
): Promise<{ rows: PayLegRow[]; truncated: boolean }> {
  const cap = opts.cap ?? SCAN_CAP;
  const payToLc = opts.payTo.toLowerCase();
  const rows: PayLegRow[] = [];
  let cursor: bigint | undefined;
  let scanned = 0;

  for (;;) {
    const page = await ledger.listByAgent(payToLc, {
      ...(cursor !== undefined ? { beforeLedgerSeq: cursor } : {}),
      limit: PAGE_SIZE,
    });
    if (page.length === 0) break;
    scanned += page.length;
    cursor = page[page.length - 1]!.ledgerSeq;

    let pageMaxAt = "";
    for (const row of page) {
      const e = row.event;
      if (e.at > pageMaxAt) pageMaxAt = e.at;
      if (e.counterparty?.toLowerCase() !== payToLc || e.at < opts.since) {
        continue;
      }
      rows.push(e);
    }

    if (scanned >= cap) return { rows, truncated: true };
    if (pageMaxAt < opts.since) break;
    if (page.length < PAGE_SIZE) break;
  }
  return { rows, truncated: false };
}
