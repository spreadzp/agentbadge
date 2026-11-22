// SLICE-258-5: snapshot → evaluatePaytoProofs input assembly for AB-189.
// Proof tier is shared via collectProofInputs (one proof SET, any
// protocol). The quoted-set here is MPP: `recipient`/`payTo` decoded
// from `WWW-Authenticate: Payment` challenges carried by
//   - l402 snapshot headers (double-probe: attempt-1 verbatim +
//     x-agentbadge-probe2-* attempt-2 keys), and
//   - x402 snapshot probes[].attempts[].mppQuotes (mixed-protocol
//     endpoints emit both rails in one challenge block).
// Authority tier: MPP live quotes are passed to the lib as the
// live402 (authoritative) tier — the protocol distinction is recorded
// in detail.evidence_tier = "live_mpp", not in the evaluation.
import type { Snapshots } from "./helpers";
import {
  observationKey,
  normalizeAddress,
  type PayToObservation,
} from "../../../../../../packages/x402-payto-proof/src/index.ts";
import {
  parsePaymentChallengeQuotes,
  mppQuotesDivergent,
  type MppQuote,
} from "../../scanner/fetchers/mpp-payment-challenge";
import {
  collectProofInputs,
  type PaytoInputs,
} from "./x402-payto-inputs";

interface X402ProbeAttemptDoc {
  status: number;
  observedAt: string;
  mppQuotes?: MppQuote[];
}

interface X402ProbeDoc {
  endpoint: string;
  attempts: X402ProbeAttemptDoc[];
  mppDivergent?: boolean;
}

function tryParse(body: string | null | undefined): unknown | null {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function collectMppInputs(sources: Snapshots): PaytoInputs | null {
  const dnsSnap = sources["x402_payto_dns"] ?? null;
  const siteSnap = sources["x402_payto_site"] ?? null;
  const l402Snap = sources["l402"] ?? null;
  const x402Snap = sources["x402"] ?? null;
  if (!dnsSnap && !siteSnap && !l402Snap && !x402Snap) return null;

  const proof = collectProofInputs(sources, [l402Snap?.url, x402Snap?.url]);
  const observedAt =
    l402Snap?.fetchedAt ?? x402Snap?.fetchedAt ?? new Date().toISOString();

  const observations: PayToObservation[] = [];
  const liveKeys = new Set<string>();
  const skipReasons = new Set<string>();
  let probed = 0;
  let anyChallenge = false;
  let divergentSeen = false;

  const push = (
    quotes: MppQuote[] | undefined,
    when: string,
    suspect: boolean,
  ) => {
    for (const q of quotes ?? []) {
      if (typeof q.payTo !== "string" || !q.payTo) continue;
      const o: PayToObservation = {
        payTo: normalizeAddress(q.payTo),
        network: q.network,
        asset: q.asset,
        source: "live402",
        observedAt: when,
        perPaymentSuspect: suspect || undefined,
      };
      const key = observationKey(o);
      if (liveKeys.has(key)) continue;
      liveKeys.add(key);
      observations.push(o);
    }
  };

  // ── l402 double-probe: attempt-1 headers verbatim + probe2 keys ─────
  const h = l402Snap?.headers ?? {};
  if (l402Snap) {
    const quotes1 = parsePaymentChallengeQuotes(h["www-authenticate"]);
    const hasProbe2 = "x-agentbadge-probe2-status" in h;
    const quotes2 = hasProbe2
      ? parsePaymentChallengeQuotes(h["x-agentbadge-probe2-www-authenticate"])
      : null;
    if (quotes1.length > 0 || (quotes2 !== null && quotes2.length > 0)) {
      anyChallenge = true;
      if (
        quotes2 === null || // legacy single-probe snapshot
        h["x-agentbadge-probe2-status"] !== "402" ||
        quotes2.length === 0
      ) {
        // Stability unproven → unchecked, never a mismatch (D-258-Q12).
        skipReasons.add("second_probe_failed");
      } else if (mppQuotesDivergent(quotes1, quotes2)) {
        divergentSeen = true;
        push(quotes1, observedAt, true);
        push(quotes2, observedAt, true);
      } else {
        push(quotes1, observedAt, false);
      }
    }
    if (hasProbe2) probed += 1;
  }

  // ── x402 probes carrying MPP quotes on the same endpoint ──────────
  const doc = tryParse(x402Snap?.body) as { probes?: X402ProbeDoc[] } | null;
  const probes = doc && Array.isArray(doc.probes) ? doc.probes : [];
  for (const p of probes) {
    if (!p || !Array.isArray(p.attempts) || p.attempts.length === 0) continue;
    const [a1, a2] = p.attempts;
    const m1 = a1?.mppQuotes ?? [];
    const m2 = a2?.mppQuotes ?? [];
    if (m1.length === 0 && m2.length === 0) continue; // endpoint isn't MPP
    anyChallenge = true;
    probed += 1;
    if (p.mppDivergent) {
      divergentSeen = true;
      for (const at of p.attempts) {
        push(at.mppQuotes, at.observedAt ?? observedAt, true);
      }
      continue;
    }
    if (!a2 || a2.status !== 402 || m2.length === 0) {
      if (m1.length > 0) skipReasons.add("second_probe_failed");
      continue;
    }
    push(m1, a1?.observedAt ?? observedAt, false);
  }

  return {
    ...proof,
    observations,
    liveKeys,
    observedAt,
    probed,
    anyProbe: anyChallenge,
    divergentSeen,
    skipReasons,
  };
}
