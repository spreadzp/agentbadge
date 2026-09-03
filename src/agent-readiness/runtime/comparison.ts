/**
 * SLICE-98-5: Declared vs Observed comparison engine
 *
 * Matches declared facts (static assertion claims) against observed facts
 * (runtime trace results) per spec §9.4 rule table. Produces CONFLICT/GAP
 * assertions that flow through the existing StatusDeterminator + 96 gap engine
 * — zero engine changes.
 *
 * Rules:
 * 1. Auth scheme mismatch → CONFLICT
 * 2. Response schema mismatch → CONFLICT
 * 3. Error semantics mismatch → CONFLICT
 * 4. Rate-limit header contradiction → CONFLICT (noise guard: absent ≠ contradiction)
 * 5. Versioning contradiction → CONFLICT
 * 6. Failed step with no declaration → GAP (runtime-proven absence)
 *
 * Determinism: same inputs → same outputs, stable ordering by rule family.
 */

import type { Assertion } from "../rule-engine/assertion-builder";
import type { Evidence } from "../rule-engine/evidence.types";

export type FactFamily =
  | "auth_scheme"
  | "response_schema"
  | "error_semantics"
  | "rate_limits"
  | "versioning"
  | "undeclared_failure";

export interface DeclaredFact {
  family: FactFamily;
  rule_id: string;
  value: string;
  claim: string;
}

export interface ObservedFact {
  family: FactFamily;
  task_id: string;
  step_seq: number;
  observed_value: string;
  observed_detail: string;
  response_ref: string;
}

export interface ComparisonResult {
  status: "CONFLICT" | "GAP";
  assertion: Assertion;
}

const RULE_FAMILY_ORDER: FactFamily[] = [
  "auth_scheme",
  "response_schema",
  "error_semantics",
  "rate_limits",
  "versioning",
  "undeclared_failure",
];

function buildRuntimeEvidence(observed: ObservedFact): Evidence {
  return {
    source: "runtime",
    detail: `RuntimeEvidence: task=${observed.task_id} step=${observed.step_seq} observed=${observed.observed_detail} ref=${observed.response_ref}`,
  };
}

function buildConflictAssertion(
  declared: DeclaredFact,
  observed: ObservedFact,
  description: string,
): Assertion {
  return {
    rule_id: declared.rule_id,
    rule_version: "1.0.0",
    status: "CONFLICT",
    evidence: [buildRuntimeEvidence(observed)],
    confidence: 0.95,
    timestamp: new Date().toISOString(),
    source_url: null,
    reason: description,
    category: "runtime",
    name: `Runtime comparison: ${declared.family}`,
    claim: declared.claim,
    verified_at: new Date().toISOString(),
    review_level: "auto",
  };
}

function buildGapAssertion(observed: ObservedFact): Assertion {
  return {
    rule_id: `RT-${observed.task_id}`,
    rule_version: "1.0.0",
    status: "GAP",
    evidence: [buildRuntimeEvidence(observed)],
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    source_url: null,
    reason: `Runtime-proven gap: ${observed.observed_detail}`,
    category: "runtime",
    name: `Runtime gap: ${observed.family}`,
    claim: `No static assertion covers this runtime failure`,
    verified_at: new Date().toISOString(),
    review_level: "auto",
  };
}

function compareRule(
  declared: DeclaredFact,
  observed: ObservedFact,
): ComparisonResult | null {
  switch (declared.family) {
    case "auth_scheme":
      if (declared.value.toLowerCase() !== observed.observed_value.toLowerCase()) {
        return {
          status: "CONFLICT",
          assertion: buildConflictAssertion(
            declared,
            observed,
            `Auth scheme mismatch: declared ${declared.value} but runtime observed ${observed.observed_value}`,
          ),
        };
      }
      return null;

    case "response_schema":
      if (normalizeSchema(declared.value) !== normalizeSchema(observed.observed_value)) {
        return {
          status: "CONFLICT",
          assertion: buildConflictAssertion(
            declared,
            observed,
            `Response schema mismatch: declared ${declared.value} but observed ${observed.observed_value}`,
          ),
        };
      }
      return null;

    case "error_semantics":
      if (declared.value.toLowerCase() !== observed.observed_value.toLowerCase()) {
        return {
          status: "CONFLICT",
          assertion: buildConflictAssertion(
            declared,
            observed,
            `Error semantics mismatch: declared ${declared.value} but observed ${observed.observed_value}`,
          ),
        };
      }
      return null;

    case "rate_limits":
      // Noise guard: absent headers ≠ contradiction
      if (!observed.observed_value || observed.observed_value.trim() === "") {
        return null;
      }
      if (normalizeRateLimit(declared.value) !== normalizeRateLimit(observed.observed_value)) {
        return {
          status: "CONFLICT",
          assertion: buildConflictAssertion(
            declared,
            observed,
            `Rate-limit header contradiction: declared ${declared.value} but observed ${observed.observed_value}`,
          ),
        };
      }
      return null;

    case "versioning":
      if (declared.value.toLowerCase() !== observed.observed_value.toLowerCase()) {
        return {
          status: "CONFLICT",
          assertion: buildConflictAssertion(
            declared,
            observed,
            `Versioning contradiction: declared ${declared.value} but observed ${observed.observed_value}`,
          ),
        };
      }
      return null;

    default:
      return null;
  }
}

function normalizeSchema(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function normalizeRateLimit(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function compareDeclaredVsObserved(
  declared: DeclaredFact[],
  observed: ObservedFact[],
): ComparisonResult[] {
  const results: ComparisonResult[] = [];
  const declaredByFamily = new Map<FactFamily, DeclaredFact[]>();

  for (const d of declared) {
    const list = declaredByFamily.get(d.family) ?? [];
    list.push(d);
    declaredByFamily.set(d.family, list);
  }

  // Process observed facts
  for (const obs of observed) {
    // Rule 6: Failed step with no declaration → GAP
    if (obs.family === "undeclared_failure") {
      const hasDeclaration = declaredByFamily.has(obs.family);
      if (!hasDeclaration) {
        results.push({
          status: "GAP",
          assertion: buildGapAssertion(obs),
        });
      }
      continue;
    }

    // Rules 1-5: match declared vs observed
    const candidates = declaredByFamily.get(obs.family) ?? [];
    for (const dec of candidates) {
      const result = compareRule(dec, obs);
      if (result) {
        results.push(result);
      }
    }
  }

  // Sort by family order for deterministic output
  results.sort((a, b) => {
    const familyA = a.assertion.category as FactFamily;
    const familyB = b.assertion.category as FactFamily;
    const idxA = RULE_FAMILY_ORDER.indexOf(familyA);
    const idxB = RULE_FAMILY_ORDER.indexOf(familyB);
    return idxA - idxB;
  });

  return results;
}
