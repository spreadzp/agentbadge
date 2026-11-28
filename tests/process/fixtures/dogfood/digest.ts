/**
 * SLICE-236-7 (D-235-9): manifest digest for the dogfood fixtures —
 * the SAME canonicalization used everywhere in the codebase
 * (eaas/verdict canonicalJson = sorted-keys deterministic JSON, the
 * JCS-equivalent convention; sha256 on the portable side per D-235-3).
 * Shared by the fixture generator (scripts/dump-process-fixtures-236-7.mts)
 * and the conformance test so they cannot drift.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../src/server/lib/eaas/verdict";

export const DIGEST_ALGORITHM = "canonical-json+sha256";

export function canonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
