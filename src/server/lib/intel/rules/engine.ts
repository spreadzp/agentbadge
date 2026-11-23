// EPIC-262 (SLICE-262-4): the envelope rules engine — pure and
// deterministic: same envelopes + same ruleset → identical findings.
// No I/O, no clock, no randomness; unknown means "the scan never
// produced evidence for this selector" — not a failure.

import type { CanonicalEnvelope } from "../evidence/envelope";
import type { IntelFinding, IntelRule } from "./types";

const byEnvelopeOrder = (a: CanonicalEnvelope, b: CanonicalEnvelope) =>
  a.received_at === b.received_at
    ? a.envelope_id.localeCompare(b.envelope_id)
    : a.received_at.localeCompare(b.received_at);

export function runRuleset(
  envelopes: CanonicalEnvelope[],
  rules: IntelRule[],
): IntelFinding[] {
  const sorted = [...envelopes].sort(byEnvelopeOrder);
  return rules
    .map((rule): IntelFinding => {
      const matched = sorted.filter(rule.select);
      const base = {
        rule_id: rule.rule_id,
        rule_version: rule.version,
        surface: rule.surface,
        severity: rule.severity,
        name: rule.name,
        claim: rule.name,
        evidence_ids: matched.map((e) => e.envelope_id),
      };
      if (matched.length === 0) {
        return { ...base, status: "unknown", reason: "no evidence" };
      }
      const verdict = rule.evaluate(matched);
      return { ...base, status: verdict.status, reason: verdict.reason };
    })
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id));
}
