import type { Assertion } from "../../rule-engine/assertion-builder";
import type { PricingSection } from "../profile-schema";
import { SECTION_CATEGORY_MAP } from "../section-map";
import { computeSectionMeta, filterByCategories } from "./section-meta-helper";

/**
 * SLICE-101-4: Payment Extractor.
 *
 * Pure function: extracts pricing section from assertions.
 * Filters by SECTION_CATEGORY_MAP.pricing categories (pricing, payments).
 * Returns undefined if zero applicable assertions.
 */

export function extractPricing(assertions: Assertion[]): PricingSection | undefined {
  const categories = SECTION_CATEGORY_MAP.pricing;
  const applicable = filterByCategories(assertions, categories);

  if (applicable.length === 0) return undefined;

  let model: string | undefined;
  let mechanism: string | undefined;
  let asset: string | undefined;
  let freeTier: boolean | undefined;

  const hasX402 = false;
  let x402Found = false;
  let pricingJsonFound = false;
  let stripeFound = false;
  let freeTierFound = false;
  let plansFound = false;
  let perCallFound = false;

  for (const a of applicable) {
    if (a.status !== "VERIFIED" && a.status !== "INFERRED") continue;

    for (const e of a.evidence) {
      const url = (e as { url?: string }).url ?? "";
      const detail = (e as { semantic_detail?: string }).semantic_detail ?? "";

      // x402 evidence
      if (
        url.includes("x402") ||
        detail.includes("x402") ||
        detail.includes("X402")
      ) {
        x402Found = true;
      }

      // Per-call pricing
      if (detail.includes("per_call") || detail.includes("per-request") || detail.includes("per_call")) {
        perCallFound = true;
      }

      // pricing.json evidence
      if (url.includes("pricing.json") || url.includes("pricing")) {
        pricingJsonFound = true;
      }

      // Free tier
      if (detail.includes("free_tier") || detail.includes("free tier") || detail.includes('"free":true')) {
        freeTierFound = true;
        freeTier = true;
      }

      // Stripe
      if (detail.includes("stripe") || detail.includes("Stripe")) {
        stripeFound = true;
      }

      // Subscription plans
      if (detail.includes("subscription") || detail.includes("plans") || detail.includes('"plans"')) {
        plansFound = true;
      }

      // Asset from agent-card
      try {
        const parsed = JSON.parse(detail);
        if (parsed.payment?.asset) {
          asset = parsed.payment.asset;
        }
        if (parsed.free_tier !== undefined) {
          freeTier = parsed.free_tier;
          if (parsed.free_tier) freeTierFound = true;
        }
      } catch {
        // Not JSON
      }
    }
  }

  // Infer model
  if (x402Found && perCallFound) {
    model = "per_call";
  } else if (x402Found) {
    model = "paid";
  } else if (pricingJsonFound && plansFound) {
    model = "subscription";
  } else if (pricingJsonFound && freeTierFound) {
    model = "freemium";
  } else if (!x402Found && !pricingJsonFound) {
    model = "free";
  } else {
    model = "freemium";
  }

  // Infer mechanism
  if (x402Found) {
    mechanism = "x402";
  } else if (stripeFound) {
    mechanism = "stripe";
  } else {
    mechanism = "none";
  }

  const meta = computeSectionMeta(applicable);

  return {
    data: {
      model,
      mechanism,
      asset,
      free_tier: freeTier,
    },
    ...meta,
  };
}
