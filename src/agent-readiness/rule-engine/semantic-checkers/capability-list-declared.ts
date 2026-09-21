// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody } from "./helpers";

export const checkerCapabilityListDeclared: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  if (!guideSnap) return { outcome: "no_source", detail: "No guide snapshot available" };

  let hasList = false;
  let hasDescriptions = false;

  const guideBody = guideSnap.body ?? "";
  if (!guideBody) return { outcome: "no_source", detail: "Guide snapshot has no body" };

  // Try parsing as JSON
  const guideJson = parseJsonBody(guideSnap) as Record<string, unknown> | null;
  if (guideJson) {
    const capabilities = (guideJson as Record<string, unknown>).capabilities as unknown[] | undefined;
    const endpoints = (guideJson as Record<string, unknown>).endpoints as unknown[] | undefined;
    const features = (guideJson as Record<string, unknown>).features as unknown[] | undefined;
    const list = capabilities ?? endpoints ?? features;
    if (list && Array.isArray(list) && list.length > 0) {
      hasList = true;
      for (const item of list) {
        if (typeof item === "object" && item !== null) {
          const desc = (item as Record<string, unknown>).description as string | undefined;
          if (desc && desc.trim().length > 0) {
            hasDescriptions = true;
            break;
          }
        }
      }
    }
  }

  // Fallback: check guide body text for capability-like content
  if (!hasList) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("## capabilities") || lower.includes("## endpoints") || lower.includes("## features") || lower.includes("## what we do")) {
      hasList = true;
      // Check if items have descriptions (text after the list item)
      if (lower.includes("- ") && lower.split("- ").length > 3) {
        hasDescriptions = true;
      }
    }
  }

  if (hasList && hasDescriptions) {
    return { outcome: "found", detail: "Capability list with per-item descriptions found in guide" };
  }
  if (hasList) {
    return { outcome: "partial", detail: "Capability list present but items lack descriptions" };
  }
  return { outcome: "absent", detail: "No capability list found in guide" };
};

// ─── AB-159: Business constraints documented ────────────────────────────────
