// EPIC-262 (SLICE-262-4): rules-on-envelope — rule + finding types.
// Two INDEPENDENT axes: readiness (can agents find/understand the site)
// and exposure (what it shouldn't reveal) — a surface tag lives on every
// finding and the two are NEVER merged into one score (D-UX-Q3).

import type { CanonicalEnvelope } from "../evidence/envelope";

export type IntelRuleSurface = "readiness" | "exposure";
export type IntelFindingStatus = "pass" | "fail" | "warn" | "unknown";
export type IntelSeverity = "low" | "medium" | "high" | "critical";

export interface RuleVerdict {
  /** never "unknown" — the engine emits that itself when no
   *  envelopes matched the selector (honest "not checked") */
  status: Exclude<IntelFindingStatus, "unknown">;
  reason: string;
}

export interface IntelRule {
  /** stable id — AB-INTEL-R-### (readiness) | AB-INTEL-X-### (exposure) */
  rule_id: string;
  /** semver of the check logic — feeds ruleset_version for MoM delta */
  version: string;
  surface: IntelRuleSurface;
  severity: IntelSeverity;
  name: string;
  /** which canonical envelopes this rule reads (pure selector) */
  select(env: CanonicalEnvelope): boolean;
  /** pure verdict over the matched envelopes — never sees an empty set */
  evaluate(matched: CanonicalEnvelope[]): RuleVerdict;
}

export interface IntelFinding {
  rule_id: string;
  rule_version: string;
  surface: IntelRuleSurface;
  severity: IntelSeverity;
  name: string;
  status: IntelFindingStatus;
  claim: string;
  reason: string;
  /** envelope_ids the verdict rested on — provenance links, never
   *  trust escalation */
  evidence_ids: string[];
}

export interface IntelRuleset {
  ruleset_version: string;
  rules: IntelRule[];
}
