/**
 * Telegram message formatting (EPIC-141, SLICE-141-9).
 * Pure functions — no I/O.
 */

import type { DeltaView, DeltaEvent } from "@agentbadge/bstock-tracker";

function fmtPrice(p: number | null): string {
  return p === null ? "—" : p.toFixed(2);
}

function fmtDelta(d: number | null): string {
  if (d === null) return "—";
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}%`;
}

/** `⚡ AAPLB 182.50 (Binance) vs 181.20 (NASDAQ) | Delta: +0.72% | phase: O` */
export function formatAlert(v: DeltaView): string {
  return (
    `⚡ ${v.symbol} ${fmtPrice(v.bStockPrice)} (Binance) vs ` +
    `${fmtPrice(v.underlyingPrice)} (NASDAQ) | ` +
    `Delta: ${fmtDelta(v.deltaPct)} | phase: ${v.phase}`
  );
}

/** tradingStatus / tradability engine events → one line. */
export function formatEvent(e: DeltaEvent): string {
  const detail = e.status ?? e.value ?? e.msg ?? "";
  return `📣 ${e.symbol} ${e.type}: ${detail}`.trim();
}

/** Hourly digest — one line per tracked symbol. */
export function buildDigest(views: DeltaView[]): string {
  const lines = views.map(
    (v) =>
      `${v.symbol}: ${fmtDelta(v.deltaPct)} ` +
      `(${fmtPrice(v.bStockPrice)} vs ${fmtPrice(v.underlyingPrice)}, ` +
      `phase ${v.phase}${v.stale ? ", stale" : ""})`,
  );
  return [`📊 bStock delta digest — ${views.length} symbols`, ...lines].join(
    "\n",
  );
}
