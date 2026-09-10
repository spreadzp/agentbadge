/**
 * SLICE-101-1: Section → category mapping.
 * Spec v0.9 §12.3: each profile section maps to one or more rule categories.
 * Exported as a constant — no new scan logic, just transformation.
 */

/**
 * Maps profile sections to the rule categories that contribute evidence.
 * Categories not mapped to any section (e.g. verification, seo_aeo) are
 * general-purpose and contribute to readiness score but not a specific section.
 */
export const SECTION_CATEGORY_MAP: Record<
  "capabilities" | "auth" | "pricing" | "limits" | "errors" | "policies",
  string[]
> = {
  capabilities: ["discovery", "documentation", "openapi", "webmcp", "machine_readable", "content_negotiation", "skills"],
  auth: ["bot_auth", "identity", "sandbox"],
  pricing: ["pricing", "payments"],
  limits: ["rate_limits"],
  errors: ["error_semantics", "retry_semantics"],
  policies: ["agent_policy", "agents_txt", "accessibility", "actionability"],
};

/**
 * All existing rule categories in the codebase.
 * Used for completeness checks and future validation.
 */
export const ALL_CATEGORIES: string[] = [
  "accessibility",
  "actionability",
  "agent_policy",
  "agents_txt",
  "bazaar",
  "bot_auth",
  "content_negotiation",
  "discovery",
  "documentation",
  "error_semantics",
  "identity",
  "infrastructure",
  "machine_readable",
  "openapi",
  "payments",
  "pricing",
  "rate_limits",
  "retry_semantics",
  "sandbox",
  "seo_aeo",
  "skills",
  "verification",
  "versioning",
  "webmcp",
];

/**
 * Profile sections in canonical order.
 */
export const SECTION_ORDER = ["capabilities", "auth", "pricing", "limits", "errors", "policies"] as const;
