// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody } from "./helpers";

export const checkerSupportPathDeclared: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  const llmsSnap = sources.llms;
  const securityTxtSnap = sources.security_txt;
  const hasAnySource = guideSnap || llmsSnap || securityTxtSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let dedicatedSupport = false;
  let genericContact = false;

  // Check guide for support field
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const guideJson = parseJsonBody(guideSnap) as Record<string, unknown> | null;
    if (guideJson) {
      const support = (guideJson as Record<string, unknown>).support as Record<string, unknown> | string | undefined;
      if (support) {
        if (typeof support === "string" && (support.includes("@") || support.includes("http"))) {
          dedicatedSupport = true;
        } else if (typeof support === "object" && support !== null) {
          const email = (support as Record<string, unknown>).email as string | undefined;
          const url = (support as Record<string, unknown>).url as string | undefined;
          if (email?.includes("@") || url?.includes("http")) {
            dedicatedSupport = true;
          }
        }
      }
    }

    // Fallback: text-based
    const lower = guideBody.toLowerCase();
    if (lower.includes("support@") || lower.includes("support ") && lower.includes("email") || lower.includes("/support") || lower.includes("help@") || lower.includes("contact@")) {
      dedicatedSupport = true;
    }
    if (lower.includes("/contact") || lower.includes("contact us") || lower.includes("contact page")) {
      if (!dedicatedSupport) genericContact = true;
    }
  }

  // Check llms.txt for support section
  const llmsBody = llmsSnap?.body ?? "";
  if (llmsBody) {
    const lower = llmsBody.toLowerCase();
    if (lower.includes("## support") || lower.includes("## contact") || lower.includes("support:")) {
      if (lower.includes("@") || lower.includes("http") || lower.includes("mailto:")) {
        dedicatedSupport = true;
      }
    }
  }

  // Check security.txt (RFC 9116) for Contact
  const securityTxtBody = securityTxtSnap?.body ?? "";
  if (securityTxtBody) {
    const lower = securityTxtBody.toLowerCase();
    if (lower.includes("contact:") && (lower.includes("mailto:") || lower.includes("http") || lower.includes("@"))) {
      dedicatedSupport = true;
    }
  }

  if (dedicatedSupport) {
    return { outcome: "found", detail: "Dedicated support contact declared" };
  }
  if (genericContact) {
    return { outcome: "partial", detail: "Only generic contact page URL found" };
  }
  return { outcome: "absent", detail: "No support contact found in any source" };
};

// ─── AB-161 (EPIC-125): AI-Agent Discovery meta tags ────────────────────────
