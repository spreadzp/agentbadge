/**
 * SLICE-255-2: result classification — faithful-or-flagged (D-255-Q3).
 *
 *   PASS             — actual verdict matches expected AND the decisive
 *                      MMF check has a prod-mapped mechanism
 *   DIVERGENCE-BUG   — mismatch that is a defect in our code
 *                      (e.g. unsafe amount reserved unsafely)
 *   DIVERGENCE-MODEL — mismatch from a semantic gap between models
 *                      (lexeme amounts, clamp-vs-reject, check order)
 *   NOT_MAPPABLE     — the decisive check has NO prod mechanism
 *                      (payee / currency / expiry / rejected-input /
 *                      delegation chains / lifecycle steps)
 *   HARNESS_ERROR    — our adapter/test broke, not prod
 *   GATE_EXCEPTION   — prod threw (e.g. registry.get rejected)
 */
import type { CoreVector } from "./mmf-types";
import type { ResultStatus } from "./result";

export interface ActualVerdict {
  /** undefined → harness could not obtain a verdict. */
  allowed?: boolean;
  /** Deny mapped to an MMF check-id (scenario-aware; null=ours only). */
  checkId?: string | null;
  /** Raw deny reason as emitted (cap name / kind / suspend / delegate). */
  rawDeny?: string;
  threw?: string;
  /** Harness flag: scalar was hazardous (≤0, non-finite, non-integer
   *  string) and still passed — drives BUG vs MODEL classification. */
  unsafeAmount?: boolean;
}

/** MMF check-ids a spend-decision on our side can plausibly emit. */
const OUR_CHECKS = new Set([
  "WITHIN",
  "CAP_EXCEEDED",
  "BUDGET",
  "VELOCITY",
  "REVOKED",
  "REVOKED_REGISTRY",
]);

export function classifyCore(
  actual: ActualVerdict,
  expected: CoreVector["expect"],
): ResultStatus {
  if (actual.threw) return "GATE_EXCEPTION";
  if (actual.allowed === undefined) return "HARNESS_ERROR"; // before label checks
  if (expected.rejected) {
    // Shedrack ruling (mandata#32, Q4): `rejected` binds any impl
    // that admits the input into its evaluation path — an allowed
    // spend on malformed input is a genuine non-conformance = BUG.
    // A deny anyway is a rejection for our own reason, mechanism
    // differs → MODEL.
    return actual.allowed === true ? "DIVERGENCE-BUG" : "DIVERGENCE-MODEL";
  }
  const expectedCheck = expected.check ?? (expected.allowed ? "WITHIN" : "");
  if (!OUR_CHECKS.has(expectedCheck)) {
    // Decisive check has no prod mechanism. When it is an amount-
    // validity check AND we nevertheless let the spend through with
    // a hazardous scalar (0/negative/non-finite), that is a defect,
    // not just an unmapped dimension.
    if (
      expectedCheck === "NON_POSITIVE" &&
      actual.allowed === true &&
      actual.unsafeAmount === true
    ) {
      return "DIVERGENCE-BUG";
    }
    return actual.allowed === expected.allowed
      ? "DIVERGENCE-MODEL" // same verdict, unreachable check (e.g. V28)
      : "NOT_MAPPABLE";
  }
  if (expected.allowed === actual.allowed) {
    if (!expected.allowed) {
      return actual.checkId === expected.check
        ? "PASS"
        : "DIVERGENCE-MODEL"; // denied — different first-failure check
    }
    return "PASS";
  }
  return actual.unsafeAmount === true ? "DIVERGENCE-BUG" : "DIVERGENCE-MODEL";
}

/** Step-level verdict compare for delegation steps. When the
 *  expectation carries a `check`, the emitted checkId must match it —
 *  a deny for the wrong reason is not a match. */
export function classifyStep(
  expect: string | Record<string, unknown> | undefined,
  actual: { ok: boolean; checkId?: string | null },
): "match" | "mismatch" | "unmapped" {
  if (expect === "valid") return actual.ok ? "match" : "mismatch";
  if (expect === "invalid") return actual.ok ? "mismatch" : "match";
  if (expect && typeof expect === "object") {
    const e = expect as { allowed?: boolean; check?: string };
    if (e.allowed !== undefined) {
      const checkOk = e.check === undefined || e.check === actual.checkId;
      return e.allowed === actual.ok && checkOk ? "match" : "mismatch";
    }
    if (e.check !== undefined) {
      return e.check === actual.checkId ? "match" : "mismatch";
    }
  }
  return "unmapped";
}
