#!/usr/bin/env bun
/**
 * SLICE-201-7: scan-src report — attribution events grouped by source.
 * Reads audit events where source matches the src= scheme (`channel:slug`)
 * and prints conversion counts per source. Run: bun scripts/scan-src-report.ts
 */
import { auditStore } from "../src/server/lib/keeperhub-audit-store";
import { parseSrc } from "../src/server/lib/src-attribution";

const events = await auditStore.list({ limit: 5000 });
const attributed = events.filter((e) => parseSrc(e.source) !== null);

const bySource = new Map<string, { count: number; urls: Set<string> }>();
for (const e of attributed) {
  const row = bySource.get(e.source) ?? { count: 0, urls: new Set() };
  row.count++;
  row.urls.add(e.siteUrl);
  bySource.set(e.source, row);
}

console.log(`# Scan attribution report — ${new Date().toISOString()}`);
console.log(`attributed events: ${attributed.length} / total: ${events.length}\n`);
if (bySource.size === 0) {
  console.log("No src= attributed scans yet.");
} else {
  console.log("| source | scans | unique targets |");
  console.log("|--------|-------|----------------|");
  for (const [src, row] of [...bySource.entries()].sort()) {
    console.log(`| ${src} | ${row.count} | ${row.urls.size} |`);
  }
}
