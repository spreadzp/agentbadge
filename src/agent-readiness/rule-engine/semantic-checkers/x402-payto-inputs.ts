// SLICE-258-4: snapshot → evaluatePaytoProofs input assembly (split from
// x402-payto-proof.ts under the 300-line file guard).
//
// Decodes the three snapshot payloads the scan produces and builds the
// PayToObservation set: live402 accepts from double-probe results
// (authoritative) + manifest payTo (hint only, D-258-Q11).
import type { Snapshots } from "./helpers";
import {
  parseDnsTxtRecords,
  parseWellKnownFile,
  observationKey,
  normalizeAddress,
  type PayToObservation,
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

interface X402ProbeAttempt {
  status: number;
  observedAt: string;
  accepts: { scheme?: string; network?: string; asset?: string; payTo?: string }[] | null;
}

interface X402DoubleProbe {
  endpoint: string;
  method: string;
  attempts: X402ProbeAttempt[];
  divergent: boolean;
}

interface X402DiscoveryDoc {
  manifest: unknown;
  probes: X402DoubleProbe[];
}

export interface PaytoInputs {
  domain: string;
  observations: PayToObservation[];
  /** observationKey set covering every live402 observation. */
  liveKeys: Set<string>;
  dnsEntries: ProofEntry[];
  siteEntries: ProofEntry[];
  malformedCount: number;
  dnsState: "ok" | "unchecked";
  siteState: "ok" | "absent" | "unchecked";
  liveRecheckDone: boolean;
  /** DNS walk was truncated by a shared-hosting suffix (D-258-Q19). */
  pslStopped: boolean;
  observedAt: string;
  /** Endpoints actually double-probed. */
  probed: number;
  anyProbe: boolean;
  divergentSeen: boolean;
  skipReasons: Set<string>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tryParse(body: string | null | undefined): unknown | null {
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
  const dnsResult = tryParse(dnsSnap?.body) as PayToDnsFetchResult | null;
  if (dnsResult && typeof dnsResult === "object") {
    domain = dnsResult.domain ?? "";
    dnsState = dnsResult.status === "unchecked" ? "unchecked" : "ok";
    pslStopped = dnsResult.pslStopped === true;
    // A fresh lookup in this scan IS the live re-check (dogfood parity);
    // a cache hit cannot prove substitution.
    liveRecheckDone = dnsResult.fromCache === false;
    for (const p of parseDnsTxtRecords((dnsResult.records ?? []).map((r) => txtChunks(r.data)))) {
      if (p.status === "ok" && p.entry) dnsEntries.push(p.entry);
      else malformedCount += 1;
    }
  }

  // Well-known tier (weaker — shadowed by any DNS proof, enforced in lib)
  const siteEntries: ProofEntry[] = [];
  let siteState: "ok" | "absent" | "unchecked" = "unchecked";
  const siteResult = tryParse(siteSnap?.body) as PayToWellknownFetchResult | null;
  if (siteSnap) {
    const status = siteResult?.status ?? siteSnap.status;
    if (status === 200 && siteResult?.body) {
      siteState = "ok";
      const host = domain || hostOf(siteResult.url);
      const wk = parseWellKnownFile(tryParse(siteResult.body), host);
      if (wk.status === "malformed") malformedCount += 1;
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
  };
}

export function collectPaytoInputs(sources: Snapshots): PaytoInputs | null {
  const dnsSnap = sources["x402_payto_dns"] ?? null;
  const siteSnap = sources["x402_payto_site"] ?? null;
  const x402Snap = sources["x402"] ?? null;
  if (!dnsSnap && !siteSnap && !x402Snap) return null;

  const proof = collectProofInputs(sources, [x402Snap?.url]);

  // Observations: live402 accepts (authoritative) from probe results
  const observations: PayToObservation[] = [];
  const liveKeys = new Set<string>();
  const skipReasons = new Set<string>();
  let probed = 0;
  let anyProbe = false;
  let divergentSeen = false;
  let manifestDoc: unknown = null;
  let probes: X402DoubleProbe[] = [];

  const x402Doc = tryParse(x402Snap?.body) as X402DiscoveryDoc | Record<string, unknown> | null;
  if (x402Doc && typeof x402Doc === "object") {
    if ("manifest" in x402Doc || "probes" in x402Doc) {
      manifestDoc = (x402Doc as X402DiscoveryDoc).manifest ?? null;
      probes = Array.isArray((x402Doc as X402DiscoveryDoc).probes)
        ? (x402Doc as X402DiscoveryDoc).probes
        : [];
    } else {
      manifestDoc = x402Doc; // legacy snapshot: body IS the manifest
    }
  }

  for (const p of probes) {
    if (!p || !Array.isArray(p.attempts) || p.attempts.length === 0) continue;
    anyProbe = true;
    probed += 1;
    const [a1, a2] = p.attempts;
    const pushAccepts = (acc: X402ProbeAttempt["accepts"], observedAt: string, suspect: boolean) => {
      for (const a of acc ?? []) {
        if (typeof a.payTo !== "string" || !a.payTo) continue;
        const o: PayToObservation = {
          payTo: normalizeAddress(a.payTo),
          network: a.network,
          asset: a.asset,
          source: "live402",
          observedAt,
          perPaymentSuspect: suspect || undefined,
        };
        const key = observationKey(o);
        if (liveKeys.has(key)) continue;
        liveKeys.add(key);
        observations.push(o);
      }
    };
    if (p.divergent) {
      // Per-payment/deposit heuristic (D-258-Q12): both quotes are
      // evidence, both exempt — a mismatch verdict would be meaningless.
      divergentSeen = true;
      for (const at of p.attempts) pushAccepts(at.accepts, at.observedAt, true);
      continue;
    }
    const a2Failed = !a2 || a2.status !== 402 || !a2.accepts || a2.accepts.length === 0;
    if (!a1 || a1.status !== 402 || !a1.accepts || a1.accepts.length === 0) {
      skipReasons.add("no_accepts_in_402");
      continue;
    }
    if (a2Failed) {
      // Second request failed → unchecked, never a mismatch (D-258-Q12).
      skipReasons.add("second_probe_failed");
      continue;
    }
    pushAccepts(a1.accepts, a1.observedAt, false);
  }

  // Manifest hint — may confirm, never causes mismatch (D-258-Q11).
  const m = (manifestDoc ?? null) as Record<string, unknown> | null;
  const mPayTo = typeof m?.payTo === "string" ? m.payTo : null;
  if (mPayTo && !observations.some((o) => o.payTo === normalizeAddress(mPayTo))) {
    observations.push({
      payTo: normalizeAddress(mPayTo),
      network: typeof m?.network === "string" ? m.network : undefined,
      source: "manifest",
      observedAt: x402Snap?.fetchedAt ?? new Date().toISOString(),
    });
  }

  return {
    ...proof,
    observations,
    liveKeys,
    observedAt: x402Snap?.fetchedAt ?? dnsSnap?.fetchedAt ?? new Date().toISOString(),
    probed,
    anyProbe,
    divergentSeen,
    skipReasons,
  };
}
