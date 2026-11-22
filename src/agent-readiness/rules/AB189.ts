// SLICE-258-5: MPP recipient proof (WWW-Authenticate: Payment).
// Same ownership check as AB-188 but the quoted-set is the MPP
// `recipient` — an MPP-only site may have no x402 at all.
// counted_in_score: false in v1 (D-258-Q3, same contour as AB-188).
import type { AgentReadinessRule } from "../rule.schema";

export const AB189: AgentReadinessRule = {
  rule_id: "AB-189",
  version: "1.0.0",
  name: "MPP payout recipient proof",
  category: "payments",
  pillar: "verifiability",
  severity: "low",
  counted_in_score: false,
  applicability: {
    condition: "site returns an MPP Payment challenge",
    description:
      "Applies when the scanned site answers a request with WWW-Authenticate: Payment (MPP) — the quoted recipient is checked against the published payout proof",
  },
  check: {
    type: "semantic_validation",
    sources: ["x402_payto_dns", "x402_payto_site", "l402", "x402"],
    semantic: "mpp_recipient_proof",
  },
  fix: {
    eligible: false,
    type: "none",
    note: "Owner-side DNS/hosting operation: publish a payout proof per draft-x402payto1 — TXT _x402-payto.<domain> or /.well-known/x402-payto.json",
  },
  display_question: "Does the domain prove ownership of its MPP payout recipient?",
  gap_type: "evidence",
  fix_hint: "manual",
};
