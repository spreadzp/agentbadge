// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody } from "./helpers";

export const checkerSkillJsonLd: SemanticChecker = (sources) => {
  const snap = sources.skill_json;
  if (!snap) return { outcome: "no_source", detail: "Skill.json snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "/skill.json not found (HTTP 404 or network error)" };
  }

  if (snap.status >= 400) {
    return { outcome: "absent", detail: `/skill.json returned HTTP ${snap.status}` };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "/skill.json returned empty body" };
  }

  const parsed = parseJsonBody(snap) as Record<string, unknown> | null;
  if (!parsed) {
    return { outcome: "absent", detail: "/skill.json is not valid JSON" };
  }

  const hasContext = "@context" in parsed;
  const hasType = "@type" in parsed;
  if (!hasContext || !hasType) {
    const missing: string[] = [];
    if (!hasContext) missing.push("@context");
    if (!hasType) missing.push("@type");
    return {
      outcome: "partial",
      detail: `/skill.json missing JSON-LD fields: ${missing.join(", ")}`,
    };
  }

  const hasName = "name" in parsed && typeof parsed.name === "string";
  const hasUrl = "url" in parsed || "endpoints" in parsed;
  if (!hasName || !hasUrl) {
    const missing: string[] = [];
    if (!hasName) missing.push("name");
    if (!hasUrl) missing.push("url or endpoints");
    return {
      outcome: "partial",
      detail: `/skill.json missing required fields: ${missing.join(", ")}`,
    };
  }

  return {
    outcome: "found",
    detail: `/skill.json is valid JSON-LD with @context, @type, name, and ${"url" in parsed ? "url" : "endpoints"}`,
  };
};

// ─── AB-164 (EPIC-125): Error catalog endpoint ───────────────────────────────
