import { createHash } from "node:crypto";
import { canonicalizeJson } from "./jcs";

/**
 * Compute SHA-256 hex digest of the canonicalized report body.
 * The "body" is everything in the report EXCEPT the `integrity` field.
 */
export function computeContentHash(reportBody: Record<string, unknown>): string {
  const canonical = canonicalizeJson(reportBody);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
