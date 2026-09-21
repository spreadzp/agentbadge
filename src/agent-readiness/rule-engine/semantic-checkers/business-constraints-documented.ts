// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody } from "./helpers";

export const checkerBusinessConstraintsDocumented: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  const llmsSnap = sources.llms;
  const hasAnySource = guideSnap || llmsSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let perCapabilityConstraints = false;
  let globalConstraints = false;

  // Check guide for per-capability constraints
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const guideJson = parseJsonBody(guideSnap) as Record<string, unknown> | null;
    if (guideJson) {
      const capabilities = (guideJson as Record<string, unknown>).capabilities as unknown[] | undefined;
      const endpoints = (guideJson as Record<string, unknown>).endpoints as unknown[] | undefined;
      const list = capabilities ?? endpoints;
      if (list && Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === "object" && item !== null) {
            const constraints = (item as Record<string, unknown>).constraints as unknown[] | Record<string, unknown> | undefined;
            const policies = (item as Record<string, unknown>).policies as unknown[] | Record<string, unknown> | undefined;
            const limits = (item as Record<string, unknown>).limits as Record<string, unknown> | undefined;
            if (constraints || policies || limits) {
              perCapabilityConstraints = true;
              break;
            }
          }
        }
      }
    }

    // Fallback: text-based check
    const lower = guideBody.toLowerCase();
    if (lower.includes("refund") || lower.includes("cancellation") || lower.includes("constraint") || lower.includes("limit") || lower.includes("window")) {
      if (lower.includes("per ") || lower.includes("each ") || lower.includes("for ") || lower.includes("capability") || lower.includes("endpoint")) {
        perCapabilityConstraints = true;
      } else {
        globalConstraints = true;
      }
    }
  }

  // Check llms.txt for constraints section
  const llmsBody = llmsSnap?.body ?? "";
  if (llmsBody) {
    const lower = llmsBody.toLowerCase();
    if (lower.includes("## constraints") || lower.includes("## limits") || lower.includes("## policies")) {
      if (lower.includes("refund") || lower.includes("cancellation") || lower.includes("limit") || lower.includes("window")) {
        perCapabilityConstraints = true;
      } else {
        globalConstraints = true;
      }
    }
  }

  if (perCapabilityConstraints) {
    return { outcome: "found", detail: "Per-capability business constraints documented" };
  }
  if (globalConstraints) {
    return { outcome: "partial", detail: "Global constraints mentioned but not per-capability" };
  }
  return { outcome: "absent", detail: "No business constraints found in any source" };
};

// ─── AB-160: Support path declared ──────────────────────────────────────────
