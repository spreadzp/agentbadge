import type { Assertion } from "../../rule-engine/assertion-builder";
import type { LimitsSection } from "../profile-schema";
import { SECTION_CATEGORY_MAP } from "../section-map";
import { computeSectionMeta, filterByCategories } from "./section-meta-helper";

/**
 * SLICE-101-5: Limits Extractor.
 *
 * Pure function: extracts limits section from assertions.
 * Filters by SECTION_CATEGORY_MAP.limits categories (rate_limits).
 * Returns undefined if zero applicable assertions.
 */

export function extractLimits(assertions: Assertion[]): LimitsSection | undefined {
  const applicable = filterByCategories(assertions, SECTION_CATEGORY_MAP.limits);

  if (applicable.length === 0) return undefined;

  let rateLimit: string | undefined;
  let concurrent: number | undefined;

  for (const a of applicable) {
    if (a.status !== "VERIFIED" && a.status !== "INFERRED") continue;

    for (const e of a.evidence) {
      const detail = (e as { semantic_detail?: string }).semantic_detail ?? "";
      const headers = (e as { headers?: Record<string, string> }).headers ?? {};
      const url = (e as { url?: string }).url ?? "";

      // Rate limit from headers
      const retryAfter = headers["retry-after"];
      const rateLimitHeader = headers["x-ratelimit-limit"] ?? headers["x-rate-limit-limit"];
      const rateLimitRemaining = headers["x-ratelimit-remaining"];
      if (rateLimitHeader) {
        rateLimit = `${rateLimitHeader} req/period`;
      }

      // Rate limit from robots.txt Crawl-delay
      if (e.type === "robots") {
        const robots = e as { disallowed_paths?: string[]; allows_all?: boolean };
        if (detail.includes("Crawl-delay:")) {
          const match = detail.match(/Crawl-delay:\s*(\d+)/i);
          if (match) {
            rateLimit = rateLimit ?? `crawl-delay ${match[1]}s`;
          }
        }
      }

      // Rate limit from semantic_detail JSON
      if (detail) {
        try {
          const parsed = JSON.parse(detail);
          if (parsed.rate_limit && !rateLimit) {
            rateLimit = typeof parsed.rate_limit === "string" ? parsed.rate_limit : `${parsed.rate_limit} req/min`;
          }
          if (parsed.concurrent !== undefined) {
            concurrent = parsed.concurrent;
          }
          if (parsed.rate_limit_per_minute !== undefined && !rateLimit) {
            rateLimit = `${parsed.rate_limit_per_minute} req/min`;
          }
        } catch {
          // Not JSON
        }
      }

      // Rate limit from OpenAPI info
      if (url.includes("openapi") && detail) {
        try {
          const parsed = JSON.parse(detail);
          if (parsed["x-rate-limit"] && !rateLimit) {
            rateLimit = parsed["x-rate-limit"];
          }
        } catch {
          // Not JSON
        }
      }
    }
  }

  const meta = computeSectionMeta(applicable);

  return {
    data: {
      rate_limit: rateLimit,
      concurrent,
    },
    ...meta,
  };
}
