// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody } from "./helpers";

export const checkerAgentFeeds: SemanticChecker = (sources) => {
  const snap = sources.agent_feeds;
  if (!snap) return { outcome: "no_source", detail: "Agent feeds snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "No agent feeds found at common paths (HTTP 404 or network error)" };
  }

  if (snap.status >= 400) {
    return { outcome: "absent", detail: `Agent feeds endpoint returned HTTP ${snap.status}` };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "Agent feeds endpoint returned empty body" };
  }

  // Try JSON Feed format first
  const parsed = parseJsonBody(snap);
  if (parsed && typeof parsed === "object" && "version" in parsed) {
    const version = (parsed as Record<string, unknown>).version;
    if (typeof version === "string" && version.startsWith("https://jsonfeed.org/")) {
      const items = "items" in parsed && Array.isArray((parsed as Record<string, unknown>).items)
        ? (parsed as Record<string, unknown>).items as unknown[]
        : [];
      return {
        outcome: "found",
        detail: `Valid JSON Feed (${version}) with ${items.length} items`,
      };
    }
    return {
      outcome: "partial",
      detail: "JSON response has 'version' field but not a valid JSON Feed version URL",
    };
  }

  // Try RSS format (XML with <rss> root and <channel>)
  const lowerBody = body.toLowerCase();
  if (lowerBody.includes("<rss") && lowerBody.includes("<channel")) {
    const itemCount = (lowerBody.match(/<item[\s>]/g) || []).length;
    return {
      outcome: "found",
      detail: `Valid RSS 2.0 feed with ${itemCount} items`,
    };
  }

  // Not a recognized feed format
  return {
    outcome: "partial",
    detail: "Feed endpoint returned content but not a valid JSON Feed 1.1 or RSS 2.0 format",
  };
};

// ─── AB-166 (EPIC-125): next_call pattern in API responses ──────────────────
