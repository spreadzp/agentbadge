// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker } from "./helpers";

export const checkerHeartbeatMd: SemanticChecker = (sources) => {
  const snap = sources.heartbeat;
  if (!snap) return { outcome: "no_source", detail: "Heartbeat snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "/heartbeat.md not found (HTTP 404 or network error)" };
  }

  if (snap.status >= 400) {
    return { outcome: "absent", detail: `/heartbeat.md returned HTTP ${snap.status}` };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "/heartbeat.md returned empty body" };
  }

  const hasFrontmatter = body.trimStart().startsWith("---");
  if (!hasFrontmatter) {
    return {
      outcome: "partial",
      detail: "/heartbeat.md is Markdown but missing YAML frontmatter (---)",
    };
  }

  const lowerBody = body.toLowerCase();
  const hasKeyword = lowerBody.includes("heartbeat") || lowerBody.includes("check-in") || lowerBody.includes("checkin");
  if (!hasKeyword) {
    return {
      outcome: "partial",
      detail: "/heartbeat.md has frontmatter but missing 'heartbeat' or 'check-in' keyword",
    };
  }

  return {
    outcome: "found",
    detail: "/heartbeat.md is valid Markdown with YAML frontmatter and heartbeat content",
  };
};

// ─── AB-163 (EPIC-125): Skill.json (JSON-LD) availability ───────────────────
