// SLICE-258-4: x402 payout proof (draft-x402payto1).
// counted_in_score: false in v1 (D-258-Q3) — draft spec + adoption ~3,
// GAP lands in the report as an informational finding for adoption
// evidence; scoring turns on after the protocol stabilizes.
import type { AgentReadinessRule } from "../rule.schema";

export const AB188: AgentReadinessRule = {
  rule_id: "AB-188",
  version: "1.0.0",
  name: "x402 payout proof",
  category: "payments",
  pillar: "verifiability",
  severity: "low",
  counted_in_score: false,
  applicability: {
    condition: "site returns 402 or declares x402",
    description:
      "Applies when the scanned site advertises x402 payments (x402.json manifest or a 402 payment challenge on a declared endpoint)",
  },
  check: {
    type: "semantic_validation",
    sources: ["x402_payto_dns", "x402_payto_site", "x402"],
    semantic: "x402_payto_proof",
  },
  fix: {
    eligible: false,
    type: "none",
    note: "Owner-side DNS/hosting operation: publish a payout proof per draft-x402payto1 — TXT _x402-payto.<domain> or /.well-known/x402-payto.json",
  },
  display_question: "Does the domain prove ownership of its payout address?",
  gap_type: "evidence",
  fix_hint: "manual",
};
