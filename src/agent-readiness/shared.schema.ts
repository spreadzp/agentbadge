import { z } from "zod";

// ─── Canonical enums for Agent Readiness schemas ─────────────────────────────
// Source of truth: AGENT-READINESS-SPEC-v0.4.md, Appendix A.
// These enums MUST match the spec exactly — do not add values without
// updating the spec first.

export const categoryEnum = z
  .enum([
    "discovery",
    "documentation",
    "actionability",
    "machine_readable",
    "verification",
    "content_negotiation",
    "payments",
    "bazaar",
    "openapi",
    "skills",
    "agents_txt",
    "webmcp",
    "identity",
    "bot_auth",
    "infrastructure",
    "seo_aeo",
    "accessibility",
    "active_probing",
    // v0.4 (EPIC-95) — semantic layer categories
    "pricing",
    "rate_limits",
    "error_semantics",
    "retry_semantics",
    "sandbox",
    "versioning",
    "agent_policy",
  ])
  .describe("Rule category (25 total): 18 legacy + 7 v0.4 semantic (pricing, rate_limits, error_semantics, retry_semantics, sandbox, versioning, agent_policy)");

export const pillarEnum = z
  .enum(["discovery", "understandability", "executability", "verifiability"])
  .describe("Scoring pillar: discovery, understandability, executability, verifiability (spec v0.2 §A.7)");

export const statusEnum = z
  .enum(["VERIFIED", "INFERRED", "CONFLICT", "GAP", "NOT_APPLICABLE"])
  .describe("Assertion status: VERIFIED (direct evidence), INFERRED (indirect, carries confidence), CONFLICT (sources disagree), GAP (no evidence found — canonical V2 name; MISSING accepted as legacy input alias), NOT_APPLICABLE (rule does not apply to this scope)");

export function normalizeStatus(s: string): Status {
  return s === "MISSING" ? "GAP" : s as Status;
}

export const statusInputSchema = z
  .union([statusEnum, z.literal("MISSING")])
  .transform((v) => normalizeStatus(v));

export const severityEnum = z
  .enum(["critical", "high", "medium", "low"])
  .describe("Rule severity: critical (agents cannot proceed, triggers total ≤ 30 floor), high (triggers category floor), medium (normal), low (informational). v0.4 adds critical — see spec §A.3");

export const checkTypeEnum = z
  .enum([
    "http_fetch",
    "schema_validation",
    "exact_match",
    "cross_evidence",
    "http_probe",
    "content_parse",
    "json_rpc",
    "header_check",
    // v0.4 (EPIC-95) — semantic validation
    "semantic_validation",
  ])
  .describe("Check type (9 total): http_fetch, schema_validation, exact_match, cross_evidence, http_probe, content_parse, json_rpc, header_check, semantic_validation (v0.4: pure function parsing structured sources for semantic criteria, no LLM)");

export const fixTypeEnum = z
  .enum(["deterministic", "assisted", "none"])
  .describe("Fix type: deterministic (safe to auto-generate), assisted (requires human confirm/edit/reject), none (not fixable by AgentBadge)");

// ─── Inferred TypeScript types ────────────────────────────────────────────────

export type Category = z.infer<typeof categoryEnum>;
export type Pillar = z.infer<typeof pillarEnum>;
export type Status = z.infer<typeof statusEnum>;
export type Severity = z.infer<typeof severityEnum>;
export type CheckType = z.infer<typeof checkTypeEnum>;
export type FixType = z.infer<typeof fixTypeEnum>;

// ─── Funnel schemas (EPIC-87) ─────────────────────────────────────────────────

export const funnelStageSchema = z.object({
  name: z.string(),
  categories: z.array(z.string()),
  score: z.number(),
  passRate: z.number(),
});

export const funnelResultSchema = z.object({
  stages: z.array(funnelStageSchema),
  dropOff: z.array(z.number()),
});

export type FunnelStage = z.infer<typeof funnelStageSchema>;
export type FunnelResult = z.infer<typeof funnelResultSchema>;
