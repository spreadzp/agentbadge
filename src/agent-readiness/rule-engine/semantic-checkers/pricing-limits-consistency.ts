// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker } from "./helpers";
import { findPricingDeclarations } from "./pricing-extractors";

export const checkerPricingLimitsConsistency: SemanticChecker = (sources) => {
  const decls = findPricingDeclarations(sources);
  const hasAnySource = sources.guide || sources.openapi || sources.pricing;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  // Filter to declarations with actual price values (not prose-only)
  const priced = decls.filter((d) => d.pricePerCall && d.pricePerCall !== "prose-only");

  if (priced.length === 0) {
    return { outcome: "absent", detail: "No machine-readable pricing declarations found to cross-check" };
  }

  if (priced.length === 1) {
    return { outcome: "found", detail: `Single source (${priced[0].source}): ${priced[0].pricePerCall} — no conflict possible` };
  }

  // Compare values across sources
  const values = priced.map((d) => d.pricePerCall);
  const allMatch = values.every((v) => v === values[0]);

  if (allMatch) {
    return { outcome: "found", detail: `Pricing consistent across ${priced.length} sources: ${values[0]}` };
  }

  const conflictDetails = priced.map((d) => `${d.source}=${d.pricePerCall}`).join(", ");
  return { outcome: "absent", detail: `Pricing CONFLICT across sources: ${conflictDetails}` };
};

// ─── AB-153: Authentication clarity ─────────────────────────────────────────
