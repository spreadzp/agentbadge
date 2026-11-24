// SLICE-258-4/258-24: protocol-agnostic proof-tier input assembly
// (split from x402-payto-inputs.ts under the 300-line file guard).
//
// Decodes the `_x402-payto` DNS and `/.well-known/x402-payto.json`
// snapshot payloads into the entry sets + tier states the evaluator
// consumes. Shared by AB-188 (x402) and AB-189 (MPP).
import type { Snapshots } from "./helpers";
import {
  parseDnsTxtRecords,
  parseWellKnownFile,
  type ProofEntry,
} from "@agentbadge/x402-payto-proof";

// ─── Snapshot payload shapes (what the handlers put in body) ────────────────

interface PayToDnsFetchResult {
  domain: string;
  hitName: string | null;
  records: { data: string; ttl: number }[];
  status: "hit" | "absent" | "unchecked";
  pslStopped: boolean;
  fromCache: boolean;
  fetchTime: number;
}

interface PayToWellknownFetchResult {
  url: string;
  status: number;
  body: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function tryParseJson(body: string | null | undefined): unknown | null {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** RFC-1035 quoted `data` → character-strings (mirrors dogfood txtChunks). */
function txtChunks(data: string): string[] {
  const m = data.match(/"((?:[^"\\]|\\.)*)"/g);
  return m ? m.map((s) => s.slice(1, -1).replace(/\\"/g, '"')) : [data];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ─── Assembly ───────────────────────────────────────────────────────────────

export interface ProofInputs {
  domain: string;
  dnsEntries: ProofEntry[];
  siteEntries: ProofEntry[];
  malformedCount: number;
  dnsState: "ok" | "unchecked";
  siteState: "ok" | "absent" | "unchecked";
  liveRecheckDone: boolean;
  /** DNS walk was truncated by a shared-hosting suffix (D-258-Q19). */
  pslStopped: boolean;
  /** Name the DNS proof record resolved at — child vs parent scope (258-18). */
  dnsHitName?: string | null;
}

/**
 * The protocol-agnostic proof tier (shared by AB-188 and AB-189,
 * SLICE-258-5): `_x402-payto` DNS TXT + `/.well-known/x402-payto.json`
 * publish one proof SET that any payment protocol's quoted address is
 * checked against. `domainHints` are snapshot urls to fall back to
 * when the DNS result carries no domain.
 */
export function collectProofInputs(
  sources: Snapshots,
  domainHints: (string | undefined)[] = [],
): ProofInputs {
  const dnsSnap = sources["x402_payto_dns"] ?? null;
  const siteSnap = sources["x402_payto_site"] ?? null;

  // DNS tier
  let domain = "";
  let dnsState: "ok" | "unchecked" = "unchecked";
  let liveRecheckDone = false;
  const dnsEntries: ProofEntry[] = [];
  let malformedCount = 0;

  let pslStopped = false;
  let dnsHitName: string | null = null;
  const dnsResult = tryParseJson(dnsSnap?.body) as PayToDnsFetchResult | null;
  if (dnsResult && typeof dnsResult === "object") {
    domain = dnsResult.domain ?? "";
    dnsState = dnsResult.status === "unchecked" ? "unchecked" : "ok";
    pslStopped = dnsResult.pslStopped === true;
    dnsHitName = dnsResult.hitName ?? null;
    // A fresh RESOLVED lookup in this scan is the live re-check
    // (dogfood parity); a cache hit cannot prove substitution, and a
    // failed lookup read nothing (arc-review H2 — an "unchecked" DNS
    // must not arm the mismatch gate against the site tier it shadows).
    liveRecheckDone =
      dnsResult.fromCache === false && dnsResult.status !== "unchecked";
    for (const p of parseDnsTxtRecords((dnsResult.records ?? []).map((r) => txtChunks(r.data)))) {
      if (p.status === "ok" && p.entry) dnsEntries.push(p.entry);
      else if (p.status === "malformed") malformedCount += 1;
      // unsupported_version: spec says MUST be ignored — a v2-only
      // publisher is "absent", not "malformed" (arc-review M1).
    }
  }

  // Well-known tier (weaker — shadowed by any DNS proof, enforced in lib)
  const siteEntries: ProofEntry[] = [];
  let siteState: "ok" | "absent" | "unchecked" = "unchecked";
  const siteResult = tryParseJson(siteSnap?.body) as PayToWellknownFetchResult | null;
  if (siteSnap) {
    const status = siteResult?.status ?? siteSnap.status;
    if (status === 200 && siteResult?.body) {
      siteState = "ok";
      const host = domain || hostOf(siteResult.url);
      const wk = parseWellKnownFile(tryParseJson(siteResult.body), host);
      if (wk.status === "malformed") malformedCount += 1;
      // Skipped entries and the >20 truncation are malformedness, not
      // absence — a file that drops all its entries must not read as
      // "published but empty" (arc-review M13).
      else malformedCount += wk.errors.length;
      siteEntries.push(...wk.entries);
    } else {
      siteState = status === 404 ? "absent" : "unchecked";
    }
  }

  if (!domain) {
    domain =
      (siteResult ? hostOf(siteResult.url) : "") ||
      domainHints.map((u) => (u ? hostOf(u) : "")).find((h) => h) ||
      (dnsSnap ? hostOf(dnsSnap.url) : "");
  }

  return {
    domain,
    dnsEntries,
    siteEntries,
    malformedCount,
    dnsState,
    siteState,
    liveRecheckDone,
    pslStopped,
    dnsHitName,
  };
}
