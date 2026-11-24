// SLICE-258-4: snapshot → evaluatePaytoProofs input assembly (split from
// x402-payto-proof.ts under the 300-line file guard; proof tier moved to
// x402-proof-inputs.ts under the same guard in 258-24).
//
// Decodes the x402 discovery snapshot and builds the PayToObservation
// set: live402 accepts from double-probe results (authoritative) +
// manifest payTo (hint only, D-258-Q11).
import type { Snapshots } from "./helpers";
import {
  observationKey,
  normalizeAddress,
  type PayToObservation,
  type ProofEntry,
} from "@agentbadge/x402-payto-proof";
import { collectProofInputs, tryParseJson } from "./x402-proof-inputs";

interface X402ProbeAttempt {
  status: number;
  observedAt: string;
  accepts: { scheme?: string; network?: string; asset?: string; payTo?: string }[] | null;
}

/** Seller-controlled accepts count — bounded so evaluation stays
 *  linear in practice (arc-review M11). */
const MAX_ACCEPTS_PER_PROBE = 100;

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
  /** Name the DNS proof record resolved at — child vs parent scope (258-18). */
  dnsHitName?: string | null;
  observedAt: string;
  /** Endpoints actually double-probed. */
  probed: number;
  anyProbe: boolean;
  divergentSeen: boolean;
  skipReasons: Set<string>;
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

  const x402Doc = tryParseJson(x402Snap?.body) as X402DiscoveryDoc | Record<string, unknown> | null;
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
    const pushAccepts = (
      acc: X402ProbeAttempt["accepts"],
      observedAt: string,
      suspect: boolean,
      probeId: string,
    ) => {
      for (const a of (acc ?? []).slice(0, MAX_ACCEPTS_PER_PROBE)) {
        // Seller JSON is untrusted: entries may be null/non-object
        // (arc-review M12 — a bare `null` threw TypeError here) and
        // strings land in keys and summaries, so bound them.
        if (!a || typeof a !== "object") continue;
        if (typeof a.payTo !== "string" || !a.payTo || a.payTo.length > 256) continue;
        const o: PayToObservation = {
          payTo: normalizeAddress(a.payTo),
          network: typeof a.network === "string" ? a.network.slice(0, 128) : undefined,
          asset: typeof a.asset === "string" ? a.asset.slice(0, 64) : undefined,
          source: "live402",
          observedAt,
          probeId,
          observer: "x402-double-probe",
          perPaymentSuspect: suspect || undefined,
        };
        const key = observationKey(o);
        if (liveKeys.has(key)) {
          // A clean (non-suspect) quote of the same address beats a
          // suspect row from a divergent endpoint — otherwise the
          // suspect row would shield the real mismatch (arc-review H4).
          if (!suspect) {
            const idx = observations.findIndex(
              (x) => observationKey(x) === key && x.perPaymentSuspect,
            );
            if (idx >= 0) observations[idx] = o;
          }
          continue;
        }
        liveKeys.add(key);
        observations.push(o);
      }
    };
    if (p.divergent) {
      // Per-payment/deposit heuristic (D-258-Q12): both quotes are
      // evidence, both exempt — a mismatch verdict would be meaningless.
      divergentSeen = true;
      p.attempts.forEach((at, i) =>
        pushAccepts(at.accepts, at.observedAt, true, `${p.endpoint}#${i + 1}`),
      );
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
    pushAccepts(a1.accepts, a1.observedAt, false, `${p.endpoint}#1`);
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
      observer: "x402-manifest",
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
