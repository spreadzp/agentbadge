// SLICE-258-9: offer-and-receipt extension declaration
// (specs/extensions/extension-offer-and-receipt.md). Presence only —
// VERIFIED here means `extension_declared`, NOT a verified signature
// or a trustworthy receipt (C9, precedent AB-068). counted_in_score:
// false in v1 (D-258-Q6). Composes with AB-188: offer-receipt binds
// the server signing key to the domain; payto-proof binds payout.
import type { AgentReadinessRule } from "../rule.schema";

export const AB190: AgentReadinessRule = {
  rule_id: "AB-190",
  version: "1.0.0",
  name: "x402 offer-and-receipt extension declared",
  category: "payments",
  pillar: "verifiability",
  severity: "low",
  counted_in_score: false,
  applicability: {
    condition: "site advertises x402 payments",
    description:
      "Applies when the scanned site runs x402 (manifest or live 402) — checks whether the 402 payment-requirements response or the manifest declares the offer-and-receipt extension (signed offers/receipts)",
  },
  check: {
    type: "semantic_validation",
    sources: ["x402"],
    semantic: "offer_receipt_declared",
  },
  fix: {
    eligible: false,
    type: "none",
    note: "Server-side change: emit extensions[\"offer-receipt\"].info.offers[] in the 402 payment-requirements response and bind the signing key to did:web:<domain>",
  },
  display_question: "Does the site declare the x402 offer-and-receipt extension?",
  gap_type: "evidence",
  fix_hint: "manual",
};
