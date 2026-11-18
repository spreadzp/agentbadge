/**
 * SLICE-234-30: intent-aware 404 suggestions — whitelist only.
 *
 * Prod probes (7d): `/api/trust/<domain>` ×~80 (incl. literal
 * `:domain` copied verbatim from our openapi path-templates),
 * MCP-config probes (`/.cursor/mcp.json`, `/.vscode/mcp.json`,
 * `/.codeium/windsurf/mcp_config.json`, `/mcp.json`,
 * `/.well-known/mcp-server`) — IDEs/agents look for the MCP manifest
 * where it isn't. Both classes got a bare 404 with no hint.
 *
 * Rules:
 * - suggestions ⊆ live endpoints (guard-test enforces — a hint must
 *   never point at another 404);
 * - excluded probe classes get a bare 404 (security/generic noise —
 *   a hint there would be noise or the wrong audience);
 * - JSON branch only — the HTML 404 is unchanged;
 * - no 200-instead-of-404, no auto-redirect.
 */

export interface NotFoundHint {
  /** path patterns that trigger this hint set */
  match: RegExp;
  /** live endpoint paths — guard-test asserts each resolves */
  suggestions: string[];
}

const MCP_CONFIG_PROBES = [
  "/.cursor/mcp.json",
  "/.vscode/mcp.json",
  "/.codeium/windsurf/mcp_config.json",
  "/.windsurf/mcp_config.json",
  "/mcp.json",
  "/.well-known/mcp-server",
] as const;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const NOT_FOUND_HINTS: NotFoundHint[] = [
  {
    // /api/trust/<domain> probes — incl. literal ":domain" copied from
    // openapi path-templates. Real trust data lives elsewhere.
    match: /^\/api\/trust\//,
    suggestions: ["/api/meta/trust-tiers", "/api/v1/services", "/agent-guide"],
  },
  {
    // /join* probes — /join itself is live (SLICE-234-31); aliases and
    // subpaths get pointed at the canonical page. Career probes
    // (/join/careers etc.) stay excluded — checked before hints.
    match: /^\/join(?!$)/,
    suggestions: ["/join"],
  },
  {
    // IDE/agent MCP-config probes — the real manifest is
    // /.well-known/mcp.json (SLICE-44-6); /mcp/public is the keyless
    // JSON-RPC facade (EPIC-206); agentbadge-machine.json is the
    // machine descriptor.
    match: new RegExp(`^(?:${MCP_CONFIG_PROBES.map(escapeRe).join("|")})$`),
    suggestions: [
      "/.well-known/mcp.json",
      "/mcp/public",
      "/.well-known/agentbadge-machine.json",
      "/agent-guide",
    ],
  },
];

/**
 * Probe classes that always get a bare 404 — security scanners,
 * generic well-known probes, career-page probes. No hints: the
 * suggestion would be noise (or aimed at the wrong audience).
 */
const NOT_FOUND_EXCLUDE: RegExp[] = [
  /^\/\.env/, // /.env, /.env.local, …
  /^\/wp-/, // WordPress probes
  /^\/smoke\//, // internal smoke paths
  /^\/nonexistent/, // literal probe prefix
  /^\/\.well-known\/farcaster\.json$/, // ×106 — not Farcaster clients
  /^\/\.well-known\/host-meta$/, // ×75 — generic probe, not WebFinger
  /^\/(?:jobs|careers)(?:\/|$)/, // career probes
  /^\/join.*career/, // /join/careers etc. (/join itself is real — 234-31)
];

/** Suggestions for a 404 path, or undefined → bare 404. */
export function notFoundSuggestions(path: string): string[] | undefined {
  if (NOT_FOUND_EXCLUDE.some((re) => re.test(path))) return undefined;
  return NOT_FOUND_HINTS.find((h) => h.match.test(path))?.suggestions;
}
