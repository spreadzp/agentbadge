// SLICE-258-24: entry hygiene + tiered absence-confirmation for
// diffPaytoReports (split out of diff.ts — max-lines lint).

import { normalizeAddress } from "@agentbadge/x402-payto-proof";
import type { ProofSetEntry, ProofSetSnapshot } from "./types.js";

export const identity = (
  e: Pick<ProofSetEntry, "source" | "scope_name" | "payTo">,
) => `${e.source}|${e.scope_name}|${e.payTo}`;

export const scopeOf = (
  e: Pick<ProofSetEntry, "source" | "scope_name">,
) => `${e.source}|${e.scope_name}`;

/**
 * Snapshots may come from foreign producers (the future watcher
 * builds them without the scanner) — normalize payTo on read so a
 * checksum-case report never fabricates a DROPPED, and dedupe
 * identical members so duplicate rows don't emit twin transitions
 * (arc-review nits).
 */
export function normalizeEntries(list: ProofSetEntry[]): ProofSetEntry[] {
  const seen = new Set<string>();
  const out: ProofSetEntry[] = [];
  for (const e of list) {
    const n = { ...e, payTo: normalizeAddress(e.payTo) };
    const id = identity(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(n);
  }
  return out;
}

/**
 * Was this member's absence actually provable this run? (C13/D-258-Q27,
 * arc-review C1/H3). Confirmedness is per TIER — the snapshot-level
 * `absence_confirmed` covers DNS freshness only and must NOT shortcut
 * a site member whose well-known fetch failed.
 */
export function confirmsAbsence(
  prev: ProofSetEntry,
  cur: ProofSetSnapshot,
): boolean {
  if (prev.source === "dns") {
    // A DNS member is dropped only when the caller asserts confirmed
    // absence — a live, non-cached, resolver-agreed lookup. A bare
    // `dns_state:"ok"` can be a cache hit or a single-survivor answer:
    // never proof of revocation.
    return cur.absence_confirmed === true;
  }
  // site member: DNS must have resolved this run — an unanswered DNS
  // could have published a shadowing set.
  if (cur.dns_state !== "ok") return false;
  // If DNS now publishes a set, it rules the effective set — a site
  // member absent from it is gone regardless of the site fetch.
  const dnsHas = cur.entries.some((e) => e.source === "dns");
  if (dnsHas) return true;
  // Otherwise the member's own tier must actually have answered —
  // a well-known fetch failure is NOT evidence of removal.
  return cur.site_state !== "unchecked";
}
