import type { GapType, GapPriority, FixHint, Category, Pillar } from "../shared.schema";

// ─── Gap interface (spec v0.5 §8.1) ──────────────────────────────────────────

export interface Gap {
  gap_id: string;
  type: GapType;
  title: string;
  description: string;
  priority: GapPriority;
  priority_reason: string;
  related_rules: string[];
  evidence_refs: string[];
  fix_hint: FixHint;
  fix_artifacts: string[];
  pillar: Pillar;
  category: Category;
  frequency: number;
}

// ─── DEFAULT_GAP_TYPE_BY_CATEGORY (spec v0.5 §8.1) ───────────────────────────
// Walked AB001..AB160 rule files and classified each category by what its GAP
// means for an AI agent. See decisions.md D5 for rationale.

export const DEFAULT_GAP_TYPE_BY_CATEGORY: Record<Category, GapType> = {
  // documentation — artifact/section is absent, nothing to read
  discovery: "documentation",
  documentation: "documentation",
  machine_readable: "documentation",
  agents_txt: "documentation",
  openapi: "documentation",
  seo_aeo: "documentation",
  webmcp: "documentation",
  content_negotiation: "documentation",
  skills: "documentation",

  // semantic — artifact exists but doesn't answer the agent's question
  actionability: "semantic",
  accessibility: "semantic",
  verification: "semantic",
  pricing: "semantic",
  rate_limits: "semantic",
  error_semantics: "semantic",
  retry_semantics: "semantic",
  versioning: "semantic",
  agent_policy: "semantic",
  infrastructure: "semantic",

  // capability — the service itself lacks what agents need
  bot_auth: "capability",
  identity: "capability",
  payments: "capability",
  bazaar: "capability",
  sandbox: "capability",
  active_probing: "capability",
};

// ─── FIX_HINT_BY_GAP_TYPE (spec v0.5 §8.3) ───────────────────────────────────

export const FIX_HINT_BY_GAP_TYPE: Record<GapType, FixHint> = {
  documentation: "deterministic",
  semantic: "assisted",
  capability: "manual",
  evidence: "manual",
};
