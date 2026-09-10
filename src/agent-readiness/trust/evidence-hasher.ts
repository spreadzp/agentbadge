/**
 * SLICE-102-2: Evidence hash extractor.
 *
 * Extracts or computes per-evidence SHA-256 hashes from assertions.
 */

import { sha256Hex } from "./hashing";
import { canonicalize } from "./canonical-json";
import type { Assertion } from "../rule-engine/assertion-builder";

/**
 * Extract evidence hashes from an array of assertions.
 *
 * For each assertion, hash the canonical JSON of the assertion
 * (excluding volatile fields like timestamp/verified_at).
 *
 * Returns array of "sha256:<hex>" strings.
 */
export function extractEvidenceHashes(assertions: Assertion[]): string[] {
  return assertions.map((assertion) => {
    // Hash the stable parts of the assertion (exclude volatile timestamp fields)
    const stable = {
      rule_id: assertion.rule_id,
      rule_version: assertion.rule_version,
      status: assertion.status,
      evidence: assertion.evidence,
      confidence: assertion.confidence,
      source_url: assertion.source_url,
      reason: assertion.reason,
      category: assertion.category,
      name: assertion.name,
      claim: assertion.claim,
      review_level: assertion.review_level,
    };
    return sha256Hex(canonicalize(stable));
  });
}
