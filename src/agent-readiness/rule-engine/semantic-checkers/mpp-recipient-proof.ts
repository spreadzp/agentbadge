// SLICE-258-5: AB-189 — MPP recipient proof (WWW-Authenticate: Payment).
// Same payout-proof evaluation as AB-188, but the quoted-set is the
// MPP `recipient`/accepts.payTo decoded from Payment challenges on the
// l402 double-probe and on x402 probes of mixed-protocol endpoints.
// The proof SET is shared (x402_payto_dns/x402_payto_site); mapping is
// shared via payto-proof-verdict.ts. Every live quote here is
// evidence_tier "live_mpp" — authoritative like live402.
import type { SemanticChecker, SemanticCheckResult } from "./helpers";
import { evaluatePaytoProofs } from "@agentbadge/x402-payto-proof";
import { collectMppInputs } from "./mpp-recipient-inputs";
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
  /** SLICE-258-17: per-probe check date + probe identity (C2). */
  observed_at?: string;
  probe_id?: string;
  observer?: string;
  issued_age_days?: number | null;
  stale_issued?: boolean;
  evidence_tier: "live_mpp";
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
  freshness: "computed" | "not_computed";
  notes?: string[];
  fix?: string;
}

export const checkerMppRecipientProof: SemanticChecker = (sources): SemanticCheckResult => {
  const inputs = collectMppInputs(sources);
  if (!inputs) {
    return { outcome: "no_source", detail: "No MPP/payto snapshots available" };
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
      subject: "Payout recipient",
      noPaymentsSummary: "Site does not advertise MPP payments",
    },
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
    observed_at: a.observedAt,
    probe_id: a.probeId,
    observer: a.observer,
    issued_age_days: a.freshness?.issued_age_days,
    ...(a.freshness?.stale_issued ? { stale_issued: true } : {}),
    evidence_tier: "live_mpp",
    anomalies: a.anomalies,
  }));

  const notes = result.perAddress
    .filter((a) => a.freshness?.stale_issued)
    .map(
      (a) =>
        `proof for ${a.payTo} issued ${a.freshness!.issued_age_days} days ago`,
    );

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
    freshness: result.freshness,
    ...(notes.length ? { notes } : {}),
    ...(mapped.fix ? { fix: mapped.fix } : {}),
  };
  return { outcome: mapped.outcome, detail: JSON.stringify(detail) };
};
