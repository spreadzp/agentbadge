// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker } from "./helpers";
import { extractRateLimitFromGuide, extractRateLimitFromOpenApi, extractRateLimitFromLlms } from "./pricing-extractors";

export const checkerRateLimitsMachineReadable: SemanticChecker = (sources) => {
  const guideDecl = extractRateLimitFromGuide(sources.guide ?? null);
  const openApiDecl = extractRateLimitFromOpenApi(sources.openapi ?? null);
  const llmsDecl = extractRateLimitFromLlms(sources.llms ?? null);

  const machineReadable = [guideDecl, openApiDecl].filter(
    (d) => d !== null && d.rateLimit !== "prose-only",
  );
  const proseOnly = [guideDecl, llmsDecl].filter(
    (d) => d !== null && d.rateLimit === "prose-only",
  );

  const hasAnySource = sources.guide || sources.openapi || sources.llms;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  // Check for 429 over-limit behavior documentation
  const guideBody = sources.guide?.body ?? "";
  const llmsBody = sources.llms?.body ?? "";
  const has429Doc = guideBody.includes("429") || llmsBody.includes("429") ||
    guideBody.toLowerCase().includes("retry-after") || llmsBody.toLowerCase().includes("retry-after");

  if (machineReadable.length > 0 && has429Doc) {
    const srcs = machineReadable.map((d) => d!.source).join(", ");
    return { outcome: "found", detail: `Machine-readable rate limits in: ${srcs} (429 behavior documented)` };
  }
  if (machineReadable.length > 0) {
    const srcs = machineReadable.map((d) => d!.source).join(", ");
    return { outcome: "partial", detail: `Machine-readable rate limits in: ${srcs} but no 429 behavior documented` };
  }
  if (proseOnly.length > 0) {
    const srcs = proseOnly.map((d) => d!.source).join(", ");
    return { outcome: "partial", detail: `Rate limits mentioned in prose only: ${srcs}` };
  }
  return { outcome: "absent", detail: "No rate limit information found in any source" };
};

// ─── AB-152: Pricing/limits cross-source consistency ────────────────────────
