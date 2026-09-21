// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type HomepageMetaData, isValidHttpUrl } from "./helpers";

export const checkerAiAgentDiscoveryMeta: SemanticChecker = (sources) => {
  const snap = sources.homepage_meta;
  if (!snap) return { outcome: "no_source", detail: "Homepage snapshot not found" };

  const parsed = parseJsonBody(snap) as { data?: HomepageMetaData } | null;
  if (!parsed || !parsed.data) {
    return { outcome: "no_source", detail: "Homepage meta data could not be parsed" };
  }

  const { aiAgentDiscovery, aiAgentOnboarding } = parsed.data;

  if (!aiAgentDiscovery && !aiAgentOnboarding) {
    return {
      outcome: "absent",
      detail: "Neither ai-agent-discovery nor ai-agent-onboarding meta tags found in HTML head",
    };
  }
  if (!aiAgentDiscovery) {
    return { outcome: "absent", detail: "Missing meta tag: ai-agent-discovery" };
  }
  if (!aiAgentOnboarding) {
    return { outcome: "absent", detail: "Missing meta tag: ai-agent-onboarding" };
  }
  if (!isValidHttpUrl(aiAgentDiscovery) || !isValidHttpUrl(aiAgentOnboarding)) {
    return {
      outcome: "absent",
      detail: "Meta tag URL invalid: ai-agent-discovery or ai-agent-onboarding is not a valid http(s) URL",
    };
  }
  if (!parsed.data.aiAgentDiscoveryReachable || !parsed.data.aiAgentOnboardingReachable) {
    const unreachable: string[] = [];
    if (!parsed.data.aiAgentDiscoveryReachable) unreachable.push("ai-agent-discovery");
    if (!parsed.data.aiAgentOnboardingReachable) unreachable.push("ai-agent-onboarding");
    return {
      outcome: "partial",
      detail: `Meta tag URL unreachable: ${unreachable.join(", ")}`,
    };
  }
  return {
    outcome: "found",
    detail: `Both ai-agent-discovery (${aiAgentDiscovery}) and ai-agent-onboarding (${aiAgentOnboarding}) meta tags present with reachable URLs`,
  };
};

// ─── AB-162 (EPIC-125): Heartbeat.md availability ───────────────────────────
