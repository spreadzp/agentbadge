// SLICE-258-5: shared evaluate→outcome mapping for AB-188 (x402) and
// AB-189 (MPP). One contract — schema.md / D-258-Q14:
//   verified→found, partial→partial, any mismatch→conflict,
//   absent→absent(GAP+fix), malformed→absent(GAP+fix),
//   unchecked/manifest-only→not_applicable,
//   possible_per_payment→partial (exempt).
import type { SemanticCheckResult } from "./helpers";
import type {
  EvaluationResult,
  AddressOutcome,
  ProofOutcome,
} from "@agentbadge/x402-payto-proof";

export interface ProofCoverage {
  accepts_found: number;
  probed: number;
  verified: number;
  mismatch: number;
  absent_or_unchecked: number;
  skip_reasons: string[];
}

export interface VerdictLabels {
  /** "Payout address" (x402) / "Payout recipient" (MPP). */
  subject: string;
  /** "Site does not advertise x402 payments" / "...MPP payments". */
  noPaymentsSummary: string;
}

/** Live (= authoritative-tier) rows only, deduped by observation key. */
export function liveRows(
  result: EvaluationResult,
  liveKeys: Set<string>,
): AddressOutcome[] {
  return result.perAddress.filter((a) => liveKeys.has(a.key));
}

export function coverageOf(
  live: AddressOutcome[],
  probed: number,
  acceptsFound: number,
  conflicts: AddressOutcome[],
  skipReasons: Set<string>,
): ProofCoverage {
  const count = (o: ProofOutcome) => live.filter((a) => a.outcome === o).length;
  return {
    accepts_found: acceptsFound,
    probed,
    verified: count("verified"),
    mismatch: conflicts.length,
    absent_or_unchecked:
      count("absent") + count("unchecked") + count("malformed"),
    skip_reasons: [...skipReasons],
  };
}

export function mapEvaluationVerdict(
  result: EvaluationResult,
  live: AddressOutcome[],
  coverage: ProofCoverage,
  inputs: { anyProbe: boolean; observationsLen: number },
  labels: VerdictLabels,
): {
  outcome: SemanticCheckResult["outcome"];
  verdict: string;
  summary: string;
  fix?: string;
} {
  // D-258-Q12/ChatGPT round-2: divergent probes are exempt evidence,
  // never silent — surface as INFERRED with the explicit reason.
  const allPerPayment =
    live.length > 0 &&
    live.every((a) => a.outcome === "possible_per_payment_address");

  if (result.conflicts.length > 0 || result.aggregate === "mismatch") {
    const who = result.conflicts
      .map((c) => `${c.payTo}${c.network ? ` (${c.network})` : ""}`)
      .join(", ");
    return {
      outcome: "conflict",
      verdict: "conflict",
      summary: `Quoted ${labels.subject.toLowerCase()} does not match the published proof: ${who}`,
    };
  }

  switch (result.aggregate) {
    case "verified": {
      const v = result.perAddress.find((a) => a.outcome === "verified");
      return {
        outcome: "found",
        verdict: "verified",
        summary: `${labels.subject} proven at ${v?.level ?? "dns/site"} level${v?.issued ? `, issued ${v.issued}` : ""}`,
      };
    }
    case "partial":
      return {
        outcome: "partial",
        verdict: "partial",
        summary: `Payout proof covers ${coverage.verified}/${coverage.accepts_found} quoted addresses — see per-address breakdown`,
      };
    case "absent":
      return {
        outcome: "absent",
        verdict: "absent",
        summary: "No x402 payout proof published",
        fix: "Publish a payout proof: DNS TXT at _x402-payto.<domain> or /.well-known/x402-payto.json (draft-x402payto1)",
      };
    case "malformed":
      return {
        outcome: "absent",
        verdict: "malformed",
        summary: "x402 payout proof present but unparseable",
        fix: "Repair the proof record — expected v=x402payto1; a=<address>; d=<YYYY-MM-DD>; s=<sig> (draft-x402payto1)",
      };
    default:
      if (allPerPayment) {
        return {
          outcome: "partial",
          verdict: "possible_per_payment_address",
          summary:
            "Endpoint quoted different payTo addresses across two probes — possible per-payment/deposit addressing (exempt)",
        };
      }
      const noPayments = inputs.observationsLen === 0 && !inputs.anyProbe;
      return {
        outcome: "not_applicable",
        verdict: noPayments ? "no_payments" : "unchecked",
        summary: noPayments
          ? labels.noPaymentsSummary
          : "Payout proof could not be evaluated (probe/DNS unreachable or inconclusive)",
      };
  }
}
