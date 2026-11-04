/**
 * SLICE-206-12 (EPIC-206): ?src= attribution aggregation + report section.
 *
 * Extracted from traffic-format.ts (max-lines). TrafficRow.payload.src
 * carries the normalized registry token (middleware/traffic-log.ts);
 * a hit on a conversion path with a 2xx counts as a funnel conversion.
 */

import type { TrafficRow } from "./traffic-format";

/** Paths counted as a "conversion" when a ?src hit lands on them with 2xx. */
export const SRC_CONVERSION_PATHS = ["/api/v1/agents/register"] as const;

export type SrcStat = {
  src: string;
  hits: number;
  conversions: number;
  topPaths: [string, number][];
};

function top<K>(m: Map<K, number>, n: number): [K, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Aggregate ?src= rows: hits per registry + 2xx register conversions. */
export function srcAttributionStats(rows: TrafficRow[]): SrcStat[] {
  const acc = new Map<
    string,
    { hits: number; conversions: number; paths: Map<string, number> }
  >();
  for (const { payload: p } of rows) {
    const src = p.src;
    if (!src) continue;
    const s = acc.get(src) ?? { hits: 0, conversions: 0, paths: new Map() };
    s.hits++;
    if (
      (SRC_CONVERSION_PATHS as readonly string[]).includes(p.path ?? "") &&
      (p.status ?? 0) >= 200 &&
      (p.status ?? 0) < 300
    ) {
      s.conversions++;
    }
    const path = p.path ?? "?";
    s.paths.set(path, (s.paths.get(path) ?? 0) + 1);
    acc.set(src, s);
  }
  return [...acc.entries()]
    .map(([src, s]) => ({
      src,
      hits: s.hits,
      conversions: s.conversions,
      topPaths: top(s.paths, 3) as [string, number][],
    }))
    .sort((a, b) => b.hits - a.hits);
}

/** Render the ?src attribution section as a report body block. */
export function srcAttributionSection(rows: TrafficRow[]): string {
  const stats = srcAttributionStats(rows);
  if (stats.length === 0) return "  (no ?src-attributed hits in window)";
  const lines: string[] = [];
  for (const s of stats) {
    const conv =
      s.conversions > 0 ? ` → ${s.conversions} registration` : "";
    lines.push(`  ${s.src.padEnd(20)} ${s.hits}${conv}`);
    for (const [p, n] of s.topPaths) lines.push(`      ${p} (${n})`);
  }
  return lines.join("\n");
}
