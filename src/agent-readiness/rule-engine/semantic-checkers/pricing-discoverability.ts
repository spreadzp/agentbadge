// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker } from "./helpers";
import { extractPricingFromGuide, extractPricingFromOpenApi, extractPricingFromWellKnown, extractPricingFromLlms } from "./pricing-extractors";

export const checkerPricingDiscoverability: SemanticChecker = (sources) => {
  const guideDecl = extractPricingFromGuide(sources.guide ?? null);
  const openApiDecl = extractPricingFromOpenApi(sources.openapi ?? null);
  const wellKnownDecl = extractPricingFromWellKnown(sources.pricing ?? null);
  const llmsDecl = extractPricingFromLlms(sources.llms ?? null);

  const machineReadable = [guideDecl, openApiDecl, wellKnownDecl].filter(
    (d) => d !== null && d.pricePerCall !== "prose-only",
  );
  const proseOnly = [guideDecl, llmsDecl].filter(
    (d) => d !== null && d.pricePerCall === "prose-only",
  );

  const hasAnySource = sources.guide || sources.openapi || sources.pricing || sources.llms;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  if (machineReadable.length > 0) {
    const srcs = machineReadable.map((d) => d!.source).join(", ");
    return { outcome: "found", detail: `Machine-readable pricing found in: ${srcs}` };
  }
  if (proseOnly.length > 0) {
    const srcs = proseOnly.map((d) => d!.source).join(", ");
    return { outcome: "partial", detail: `Pricing mentioned in prose only: ${srcs}` };
  }
  return { outcome: "absent", detail: "No pricing information found in any source" };
};

// ─── AB-151: Rate limits machine-readable ───────────────────────────────────
