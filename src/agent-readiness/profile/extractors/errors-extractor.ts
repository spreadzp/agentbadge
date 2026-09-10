import type { Assertion } from "../../rule-engine/assertion-builder";
import type { ErrorsSection } from "../profile-schema";
import { SECTION_CATEGORY_MAP } from "../section-map";
import { computeSectionMeta, filterByCategories } from "./section-meta-helper";

/**
 * SLICE-101-5: Errors Extractor.
 *
 * Pure function: extracts errors section from assertions.
 * Filters by SECTION_CATEGORY_MAP.errors categories (error_semantics, retry_semantics).
 * Returns undefined if zero applicable assertions.
 */

const STANDARD_HTTP_CODES = [400, 401, 403, 404, 409, 429, 500, 502, 503, 504];

export function extractErrors(assertions: Assertion[]): ErrorsSection | undefined {
  const applicable = filterByCategories(assertions, SECTION_CATEGORY_MAP.errors);

  if (applicable.length === 0) return undefined;

  const codes = new Set<number>();
  let errorSchema: string | undefined;

  for (const a of applicable) {
    if (a.status !== "VERIFIED" && a.status !== "INFERRED") continue;

    for (const e of a.evidence) {
      const detail = (e as { semantic_detail?: string }).semantic_detail ?? "";
      const url = (e as { url?: string }).url ?? "";

      // From OpenAPI evidence
      if (e.type === "openapi" || url.includes("openapi")) {
        if (detail) {
          try {
            const parsed = JSON.parse(detail);
            // Extract response codes from paths
            if (parsed.paths) {
              for (const ops of Object.values(parsed.paths) as any[]) {
                for (const op of Object.values(ops) as any[]) {
                  if (op.responses) {
                    for (const code of Object.keys(op.responses)) {
                      const numCode = parseInt(code, 10);
                      if (!isNaN(numCode)) codes.add(numCode);
                    }
                  }
                }
              }
            }
            // Check for RFC 9457 Problem Details
            if (JSON.stringify(parsed).includes("application/problem+json") || JSON.stringify(parsed).includes("RFC 9457")) {
              errorSchema = "RFC 9457 Problem Details";
            }
            // Check for custom error schema
            if (parsed.components?.schemas?.Error) {
              errorSchema = errorSchema ?? "Custom OpenAPI Error schema";
            }
          } catch {
            // Not JSON
          }
        }
      }

      // From semantic_detail directly
      if (detail.includes("application/problem+json") || detail.includes("RFC 9457")) {
        errorSchema = "RFC 9457 Problem Details";
      }

      // Standard codes from detail
      for (const code of STANDARD_HTTP_CODES) {
        if (detail.includes(String(code))) {
          codes.add(code);
        }
      }
    }
  }

  const meta = computeSectionMeta(applicable);

  return {
    data: {
      standard_codes: Array.from(codes).sort((a, b) => a - b),
      error_schema: errorSchema,
    },
    ...meta,
  };
}
