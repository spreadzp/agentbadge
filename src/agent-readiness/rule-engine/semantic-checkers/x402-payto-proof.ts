// SLICE-258-4: AB-188 — x402 payout proof (draft-x402payto1).
// Pure semantic checker: snapshot bodies → lib evaluate → outcome.
//
// Sources: x402_payto_dns (authoritative proof tier), x402_payto_site
// (weaker tier, shadowed by any DNS proof), x402 (manifest hint +
// live-402 double-probe results embedded by the fetcher).
//
// Mapping (schema.md / D-258-Q14) shared with AB-189 — see
// payto-proof-verdict.ts. Mismatch requires a live DNS re-check — a
// cached result (`fromCache`) downgrades a non-match to unchecked +
// no_live_recheck instead of a proven substitution.
import type { SemanticChecker, SemanticCheckResult } from "./helpers";
import {
  evaluatePaytoProofs,
  observationKey,
} from "../../../../../../packages/x402-payto-proof/src/index.ts";
import { collectPaytoInputs } from "./x402-payto-inputs";
import {
  liveRows,
  coverageOf,
  mapEvaluationVerdict,
  type ProofCoverage,
} from "./payto-proof-verdict";

interface DetailPerAddress {
  key: string;
  payTo: string;
  network?: string;
  asset?: string;
  outcome: string;
  level?: string;
  issued?: string;
  signatureStatus: string;
  evidence_tier: "live402" | "manifest";
  anomalies: string[];
}

interface Detail {
  verdict: string;
  summary: string;
  domain: string;
  /** D-258-Q19: domain sits on shared hosting — own-name record only. */
  scope?: "shared_hosting_name";
  probe_stability?: "stable_across_probe_window";
  coverage: ProofCoverage;
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

  const live = liveRows(result, inputs.liveKeys);
  const coverage = coverageOf(
    live,
    inputs.probed,
    inputs.liveKeys.size,
    result.conflicts,
    inputs.skipReasons,
  );
  const mapped = mapEvaluationVerdict(
    result,
    live,
    coverage,
    { anyProbe: inputs.anyProbe, observationsLen: inputs.observations.length },
    {
      subject: "Payout address",
      noPaymentsSummary: "Site does not advertise x402 payments",
    },
  );

  // observation.key → evidence tier for the honest detail annotation.
  const tierOf = new Map(
    inputs.observations.map((o) => [observationKey(o), o.source]),
  );
  const perAddress: DetailPerAddress[] = result.perAddress.map((a) => ({
    key: a.key,
    payTo: a.payTo,
    network: a.network,
    asset: a.asset,
    outcome: a.outcome,
    level: a.level,
    issued: a.issued,
    signatureStatus: a.signatureStatus,
    evidence_tier: tierOf.get(a.key) === "manifest" ? "manifest" : "live402",
    anomalies: a.anomalies,
  }));

  const detail: Detail = {
    verdict: mapped.verdict,
    summary: mapped.summary,
    domain: inputs.domain,
    ...(inputs.pslStopped ? { scope: "shared_hosting_name" as const } : {}),
    ...(inputs.probed > 0 && !inputs.divergentSeen
      ? { probe_stability: "stable_across_probe_window" as const }
      : {}),
    coverage,
    perAddress,
    anomalies: result.anomalies,
    ...(mapped.fix ? { fix: mapped.fix } : {}),
  };
  return { outcome: mapped.outcome, detail: JSON.stringify(detail) };
};
