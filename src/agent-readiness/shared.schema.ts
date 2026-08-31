import { z } from "zod";

// ─── Canonical enums for Agent Readiness schemas ─────────────────────────────
// Source of truth: AGENT-READINESS-SPEC-v0.2.md, Appendix A.
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
  ])
  .describe("Rule category: discovery, documentation, actionability, machine_readable, verification, content_negotiation, payments, bazaar, openapi, skills, agents_txt, webmcp, identity, bot_auth, infrastructure, seo_aeo, accessibility, active_probing");

export const pillarEnum = z
  .enum(["discovery", "understandability", "executability", "verifiability"])
  .describe("Scoring pillar: discovery, understandability, executability, verifiability (spec v0.2 §A.7)");

export const statusEnum = z
  .enum(["VERIFIED", "INFERRED", "CONFLICT", "MISSING", "NOT_APPLICABLE"])
  .describe("Assertion status: VERIFIED (direct evidence), INFERRED (indirect, carries confidence), CONFLICT (sources disagree), MISSING (no evidence found), NOT_APPLICABLE (rule does not apply to this scope)");

export const severityEnum = z
  .enum(["high", "medium", "low"])
  .describe("Rule severity: high (triggers category floor), medium (normal), low (informational). Note: 'critical' is intentionally excluded from v0.1 — see spec §A.3");

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
  ])
  .describe("Check type: http_fetch (HTTP GET + parse), schema_validation (validate against JSON Schema), exact_match (string/structural equality), cross_evidence (compare two fetched sources on shared key), http_probe (HTTP request with status/header check), content_parse (parse response body for specific content), json_rpc (JSON-RPC call to MCP endpoint), header_check (verify specific HTTP headers)");

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
