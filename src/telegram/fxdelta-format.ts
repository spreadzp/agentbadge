/**
 * FX-delta Telegram message formatting (EPIC-191, SLICE-191-7).
 * Pure functions — no I/O. Port of ./format.ts with corridor fields.
 */

import type { FxDeltaView, FxDeltaEvent } from "../server/lib/fx-delta";

function fmtRate(r: number | null): string {
  return r === null ? "—" : String(Math.round(r * 10000) / 10000);
}

function fmtDelta(d: number | null): string {
  if (d === null) return "—";
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}%`;
}

/** `⚡ USDT-NGN 1520.5 (onchain) vs 1510.2 (FX ref) | Delta: +0.68% | phase: open` */
export function formatAlert(v: FxDeltaView): string {
  return (
    `⚡ ${v.corridor} ${fmtRate(v.chainRate)} (onchain) vs ` +
    `${fmtRate(v.fxRefRate)} (FX ref) | ` +
    `Delta: ${fmtDelta(v.deltaPct)}` +
    (v.phase ? ` | phase: ${v.phase}` : "") +
    (v.frozen ? " | ❄ frozen" : "") +
    (v.stale ? " | ⏸ stale" : "")
  );
}

/** Engine event → one line. */
export function formatEvent(e: FxDeltaEvent): string {
  const detail = e.msg ?? "";
  return `📣 ${e.corridor} ${e.type}: ${detail}`.trim();
}

/**
 * Hourly digest — top-3 non-thin corridors by |delta| + phase + alert
 * count for the window. Corridors whose alert was just pushed are
 * skipped (AC3: digest never re-sends a live alert).
 */
export function buildDigest(
  views: FxDeltaView[],
  opts?: { alertCount?: number; skipCorridors?: ReadonlySet<string> },
): string {
  const skip = opts?.skipCorridors ?? new Set<string>();
  const ranked = views
    .filter((v) => !v.thin && v.deltaPct !== null && !skip.has(v.corridor))
    .sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!))
    .slice(0, 3);
  const lines = ranked.map(
    (v) =>
      `${v.corridor}: ${fmtDelta(v.deltaPct)} ` +
      `(${fmtRate(v.chainRate)} vs ${fmtRate(v.fxRefRate)}, ` +
      `phase ${v.phase}${v.frozen ? ", frozen" : ""}${v.stale ? ", stale" : ""})`,
  );
  const header = `📊 FX delta digest — top-${ranked.length} |delta| movers`;
  const footer =
    opts?.alertCount !== undefined
      ? `🔔 ${opts.alertCount} alerts since last digest`
      : null;
  return [header, ...lines, ...(footer ? [footer] : [])].join("\n");
}
