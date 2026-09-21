// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
// Pricing/rate-limit extractors shared by several checkers.
import type { ResponseSnapshot } from "../../scanner/snapshot";
import { parseJsonBody, type OpenApiSpec, type Snapshots } from "./helpers";

export interface PricingDeclaration {
  source: string;
  pricePerCall?: string;
  rateLimit?: string;
}

export function extractPricingFromGuide(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  try {
    const json = JSON.parse(snap.body) as Record<string, unknown>;
    const pricing = json.pricing as Record<string, unknown> | undefined;
    if (pricing && typeof pricing === "object") {
      return {
        source: "guide",
        pricePerCall: typeof pricing.price_per_call === "string" ? pricing.price_per_call : undefined,
        rateLimit: typeof pricing.rate_limit === "string" ? pricing.rate_limit : undefined,
      };
    }
  } catch {
    // Not JSON — check prose for pricing keywords
    const lower = snap.body.toLowerCase();
    if (lower.includes("pricing") || lower.includes("cost") || lower.includes("$0.")) {
      return { source: "guide", pricePerCall: "prose-only" };
    }
  }
  return null;
}

export function extractPricingFromOpenApi(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  const spec = parseJsonBody(snap) as OpenApiSpec | null;
  if (!spec) return null;
  const ext = (spec as unknown as Record<string, unknown>).x_pricing as Record<string, unknown> | undefined;
  if (ext && typeof ext === "object") {
    return {
      source: "openapi",
      pricePerCall: typeof ext.price_per_call === "string" ? ext.price_per_call : undefined,
      rateLimit: typeof ext.rate_limit === "string" ? ext.rate_limit : undefined,
    };
  }
  return null;
}

export function extractPricingFromWellKnown(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  try {
    const json = JSON.parse(snap.body) as Record<string, unknown>;
    if (typeof json === "object" && json !== null) {
      return {
        source: "pricing.json",
        pricePerCall: typeof json.price_per_call === "string" ? json.price_per_call : undefined,
        rateLimit: typeof json.rate_limit === "string" ? json.rate_limit : undefined,
      };
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export function extractPricingFromLlms(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  const lower = snap.body.toLowerCase();
  // Structured section: "## Pricing" or "## Rate Limits" with key-value lines
  const hasPricingSection = lower.includes("## pricing") || lower.includes("## cost");
  const hasRateSection = lower.includes("## rate") || lower.includes("## limits");
  if (!hasPricingSection && !hasRateSection) {
    // Prose-only: mentions pricing/cost somewhere
    if (lower.includes("pricing") || lower.includes("cost per") || lower.includes("$0.")) {
      return { source: "llms", pricePerCall: "prose-only" };
    }
    return null;
  }
  // Try to extract structured values
  const priceMatch = snap.body.match(/price[_\s-]*per[_\s-]*call\s*[:=]\s*\S+/i);
  const rateMatch = snap.body.match(/rate[_\s-]*limit\s*[:=]\s*\S+/i);
  return {
    source: "llms",
    pricePerCall: priceMatch?.[0]?.split(/[:=]/)[1]?.trim(),
    rateLimit: rateMatch?.[0]?.split(/[:=]/)[1]?.trim(),
  };
}

export function extractRateLimitFromGuide(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  try {
    const json = JSON.parse(snap.body) as Record<string, unknown>;
    const rateLimits = json.rate_limits as Record<string, unknown> | undefined;
    if (rateLimits && typeof rateLimits === "object") {
      return {
        source: "guide",
        rateLimit: typeof rateLimits.requests_per_minute === "string"
          ? rateLimits.requests_per_minute as string
          : JSON.stringify(rateLimits),
      };
    }
  } catch {
    const lower = snap.body.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("requests per")) {
      return { source: "guide", rateLimit: "prose-only" };
    }
  }
  return null;
}

export function extractRateLimitFromOpenApi(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  const spec = parseJsonBody(snap) as OpenApiSpec | null;
  if (!spec) return null;
  const ext = (spec as unknown as Record<string, unknown>).x_rate_limit as Record<string, unknown> | undefined;
  if (ext && typeof ext === "object") {
    return {
      source: "openapi",
      rateLimit: typeof ext.requests_per_minute === "string"
        ? ext.requests_per_minute as string
        : JSON.stringify(ext),
    };
  }
  return null;
}

export function extractRateLimitFromLlms(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  const lower = snap.body.toLowerCase();
  const hasRateSection = lower.includes("## rate") || lower.includes("## limits");
  if (!hasRateSection && !lower.includes("rate limit") && !lower.includes("requests per")) {
    return null;
  }
  const rateMatch = snap.body.match(/rate[_\s-]*limit\s*[:=]\s*\S+/i);
  if (rateMatch) {
    return { source: "llms", rateLimit: rateMatch[0]?.split(/[:=]/)[1]?.trim() };
  }
  return { source: "llms", rateLimit: "prose-only" };
}

// ─── AB-150: Pricing discoverability ────────────────────────────────────────

export function findPricingDeclarations(sources: Snapshots): PricingDeclaration[] {
  const decls: PricingDeclaration[] = [];
  const guide = extractPricingFromGuide(sources.guide ?? null);
  if (guide) decls.push(guide);
  const openapi = extractPricingFromOpenApi(sources.openapi ?? null);
  if (openapi) decls.push(openapi);
  const wellKnown = extractPricingFromWellKnown(sources.pricing ?? null);
  if (wellKnown) decls.push(wellKnown);
  return decls;
}
