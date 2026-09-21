// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker } from "./helpers";

export const checkerAgentPolicyMachineReadable: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  const llmsSnap = sources.llms;
  const aiTxtSnap = sources.ai_txt;
  const hasAnySource = guideSnap || llmsSnap || aiTxtSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let explicitPolicy = false;
  let tosLinkOnly = false;

  // Check agents.txt / ai.txt for explicit Allow/Disallow
  const aiTxtBody = aiTxtSnap?.body ?? "";
  if (aiTxtBody) {
    const lower = aiTxtBody.toLowerCase();
    if (lower.includes("allow:") || lower.includes("disallow:") || lower.includes("user-agent:")) {
      // Check for AI-agent-specific rules beyond crawler defaults
      // "agent" and "bot" alone are crawler terms; look for AI-specific identifiers
      if (lower.includes("ai") || lower.includes("gpt") || lower.includes("claude") || lower.includes("automated") || lower.includes("llm") || lower.includes("permitted") || lower.includes("prohibited")) {
        explicitPolicy = true;
      }
    }
  }

  // Check guide for policy/allowedUse field
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("policy") || lower.includes("allowed use") || lower.includes("alloweduse") || lower.includes("agent policy") || lower.includes("automated") || lower.includes("permitted")) {
      if (lower.includes("allow") || lower.includes("disallow") || lower.includes("permitted") || lower.includes("prohibited") || lower.includes("restricted")) {
        explicitPolicy = true;
      }
    }
    // Generic ToS link only
    if (lower.includes("terms of service") || lower.includes("/tos") || lower.includes("/terms") || lower.includes("/legal")) {
      if (!explicitPolicy) tosLinkOnly = true;
    }
  }

  // Check llms.txt for policy section
  const llmsBody = llmsSnap?.body ?? "";
  if (llmsBody) {
    const lower = llmsBody.toLowerCase();
    if (lower.includes("## policy") || lower.includes("## agent policy") || lower.includes("allowed") || lower.includes("disallowed")) {
      explicitPolicy = true;
    }
  }

  if (explicitPolicy) {
    return { outcome: "found", detail: "Machine-readable agent policy found" };
  }
  if (tosLinkOnly) {
    return { outcome: "partial", detail: "Only generic ToS link found, no agent-specific policy" };
  }
  return { outcome: "absent", detail: "No agent policy found in any source" };
};

// ─── AB-158: Capability list declared ───────────────────────────────────────
