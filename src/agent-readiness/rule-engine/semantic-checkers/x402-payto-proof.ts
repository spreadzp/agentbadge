// SLICE-258-4: AB-188 — x402 payout proof (draft-x402payto1).
// Pure semantic checker: snapshot bodies → lib evaluate → outcome.
//
// Sources: x402_payto_dns (authoritative proof tier), x402_payto_site
// (weaker tier, shadowed by any DNS proof), x402 (manifest hint +
// live-402 double-probe results embedded by the fetcher).
//
// Mapping (schema.md / D-258-Q14): verified→found, partial→partial,
// any mismatch→conflict, absent→absent(GAP), malformed→absent(GAP+fix),
// unchecked/manifest-only→not_applicable, possible_per_payment→partial
// (exempt). Mismatch requires a live DNS re-check — a cached result
// (`fromCache`) downgrades a non-match to unchecked + no_live_recheck
// instead of a proven substitution.
import type { SemanticChecker, SemanticCheckResult } from "./helpers";
import { evaluatePaytoProofs, type ProofOutcome } from "../../../../../../packages/x402-payto-proof/src/index.ts";
import { collectPaytoInputs } from "./x402-payto-inputs";

interface DetailPerAddress {
  key: string;
  payTo: string;
  network?: string;
  asset?: string;
  outcome: string;
  level?: string;
  issued?: string;
  signatureStatus: string;
  anomalies: string[];
}

interface Detail {
  verdict: string;
  summary: string;
  domain: string;
  probe_stability?: "stable_across_probe_window";
  coverage: {
    accepts_found: number;
    probed: number;
    verified: number;
    mismatch: number;
    absent_or_unchecked: number;
    skip_reasons: string[];
  };
  perAddress: DetailPerAddress[];
  anomalies: string[];
  fix?: string;
}

export const checkerX402PaytoProof: SemanticChecker = (sources): SemanticCheckResult => {
  const inputs = collectPaytoInputs(sources);
  if (!inputs) {
    return { outcome: "no_source", detail: "No x402/payto snapshots available" };
  }

  const result = evaluatePaytoProofs({
    observations: inputs.observations,
    dnsEntries: inputs.dnsEntries,
    siteEntries: inputs.siteEntries,
    malformedCount: inputs.malformedCount,
    dnsState: inputs.dnsState,
    siteState: inputs.siteState,
    liveRecheckDone: inputs.liveRecheckDone,
    observedAt: inputs.observedAt,
    domain: inputs.domain,
  });

  const live = result.perAddress.filter((a) => inputs.liveKeys.has(a.key));
  const liveCount = (o: ProofOutcome) => live.filter((a) => a.outcome === o).length;

  const coverage = {
    accepts_found: inputs.liveKeys.size,
    probed: inputs.probed,
    verified: liveCount("verified"),
    mismatch: result.conflicts.length,
    absent_or_unchecked:
      liveCount("absent") + liveCount("unchecked") + liveCount("malformed"),
    skip_reasons: [...inputs.skipReasons],
  };

  const perAddress: DetailPerAddress[] = result.perAddress.map((a) => ({
    key: a.key,
    payTo: a.payTo,
    network: a.network,
    asset: a.asset,
    outcome: a.outcome,
    level: a.level,
    issued: a.issued,
    signatureStatus: a.signatureStatus,
    anomalies: a.anomalies,
  }));

  // D-258-Q12/ChatGPT round-2: divergent probes are exempt evidence,
  // never silent — surface as INFERRED with the explicit reason.
  const allPerPayment =
    live.length > 0 && live.every((a) => a.outcome === "possible_per_payment_address");

  let outcome: SemanticCheckResult["outcome"];
  let verdict: string;
  let summary: string;
  let fix: string | undefined;

  if (result.conflicts.length > 0 || result.aggregate === "mismatch") {
    outcome = "conflict";
    verdict = "conflict";
    const who = result.conflicts
      .map((c) => `${c.payTo}${c.network ? ` (${c.network})` : ""}`)
      .join(", ");
    summary = `Quoted payout address does not match the published proof: ${who}`;
  } else {
    switch (result.aggregate) {
      case "verified": {
        outcome = "found";
        verdict = "verified";
        const v = live.find((a) => a.outcome === "verified");
        summary = `Payout address proven at ${v?.level ?? "dns/site"} level${v?.issued ? `, issued ${v.issued}` : ""}`;
        break;
      }
      case "partial":
        outcome = "partial";
        verdict = "partial";
        summary = `Payout proof covers ${coverage.verified}/${coverage.accepts_found} quoted addresses — see per-address breakdown`;
        break;
      case "absent":
        outcome = "absent";
        verdict = "absent";
        summary = "No x402 payout proof published";
        fix =
          "Publish a payout proof: DNS TXT at _x402-payto.<domain> or /.well-known/x402-payto.json (draft-x402payto1)";
        break;
      case "malformed":
        outcome = "absent";
        verdict = "malformed";
        summary = "x402 payout proof present but unparseable";
        fix =
          "Repair the proof record — expected v=x402payto1; a=<address>; d=<YYYY-MM-DD>; s=<sig> (draft-x402payto1)";
        break;
      default:
        // "unchecked" aggregate — distinguish the per-payment exempt
        // case (divergent double-probe) from "could not evaluate".
        if (allPerPayment) {
          outcome = "partial";
          verdict = "possible_per_payment_address";
          summary =
            "Endpoint quoted different payTo addresses across two probes — possible per-payment/deposit addressing (exempt)";
        } else {
          outcome = "not_applicable";
          verdict = inputs.observations.length === 0 && !inputs.anyProbe ? "no_payments" : "unchecked";
          summary =
            verdict === "no_payments"
              ? "Site does not advertise x402 payments"
              : "Payout proof could not be evaluated (probe/DNS unreachable or inconclusive)";
        }
    }
  }

  const detail: Detail = {
    verdict,
    summary,
    domain: inputs.domain,
    ...(inputs.probed > 0 && !inputs.divergentSeen
      ? { probe_stability: "stable_across_probe_window" as const }
      : {}),
    coverage,
    perAddress,
    anomalies: result.anomalies,
    ...(fix ? { fix } : {}),
  };
  return { outcome, detail: JSON.stringify(detail) };
};
