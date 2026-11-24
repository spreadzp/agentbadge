/**
 * EPIC-231 (SLICE-231-2, O2 → D-228-5/D-229-5): demand classification
 * dictionary v1 — deterministic substring rules over normalizedText.
 *
 * The vocabulary is CODE-side (no DB table in v1): `category` is a
 * closed-ish domain-area list seeded from STARTER_TOPICS (D-228-5);
 * `feature` terms seed from STARTER_ENTITIES + capability registry
 * name prefixes (229). `demandDictDrift()` mirrors the D-229-5
 * seed/drift-check pattern: it reports source-vocab terms the rules
 * no longer cover — a test pins coverage so a vocab change upstream
 * surfaces as drift instead of silently re-routing clusters.
 *
 * classifyDemandText is caller-overridable: seams and operators may
 * pass explicit {category, feature, capabilityKey} — the rules only
 * fill what the caller left out.
 */

import {
  STARTER_ENTITIES,
  STARTER_TOPICS,
} from "../agent-interaction/vocabulary";

/** Category vocabulary v1 — domain areas, seeded from D-228-5
 *  STARTER_TOPICS and the capability kind families (229). */
export const DEMAND_CATEGORY_TERMS = [
  "identity",
  "payments",
  "discovery",
  "reputation",
  "commerce",
  "knowledge",
  "integration",
  "observability",
  "security",
  "infrastructure",
] as const;
export type DemandCategory = (typeof DEMAND_CATEGORY_TERMS)[number];

/** Feature vocabulary v1 — entity/feature names, seeded from
 *  D-228-5 STARTER_ENTITIES + capability registry prefix families. */
export const DEMAND_FEATURE_TERMS = [
  "request-inbox",
  "agent-registration",
  "verdicts",
  "econ-ledger",
  "surveys",
  "escrow",
  "refunds",
  "passport",
  "mcp-tools",
  "manifests",
  "gap-detection",
  "feedback",
] as const;
export type DemandFeature = (typeof DEMAND_FEATURE_TERMS)[number];

export interface DemandClassifyRule {
  category: DemandCategory;
  feature?: DemandFeature;
  /** → KnowledgeCapability prefix family when the feature maps onto
   *  the 229 registry (mcp.*, check.*, x402-pack.*, manifest.*). */
  capabilityPrefix?: string;
  /** Substring terms matched against normalizedText (already
   *  lowercase) — first matching rule wins, order matters. */
  terms: readonly string[];
}

/**
 * Deterministic rules — evaluated in order, FIRST match wins.
 * Arc 231 R1 (nit): terms match on WORD BOUNDARIES — "did", "key",
 * "api", "log", "ask", "pay" no longer fire inside unrelated words
 * ("candidate", "keyboard", "billing"→"log" miss was steering
 * callers into wrong clusters). Multi-word terms keep substring
 * semantics between the words.
 */
export const DEMAND_CLASSIFY_RULES: readonly DemandClassifyRule[] = [
  {
    category: "payments",
    feature: "escrow",
    capabilityPrefix: "x402-pack.",
    terms: ["escrow", "settlement", "release", "dispute"],
  },
  {
    category: "payments",
    feature: "refunds",
    terms: ["refund", "chargeback", "reversal"],
  },
  {
    category: "payments",
    terms: ["x402", "payment", "pay", "usdc", "hbar", "invoice", "price", "pricing", "billing", "checkout"],
  },
  {
    category: "identity",
    feature: "passport",
    terms: ["passport", "did", "nft", "agent identity", "wallet", "key"],
  },
  {
    category: "identity",
    feature: "agent-registration",
    capabilityPrefix: "manifest.",
    terms: ["register", "registration", "onboard", "sign up"],
  },
  {
    category: "reputation",
    feature: "verdicts",
    capabilityPrefix: "check.",
    terms: ["verdict", "score", "tier", "reputation", "trust", "attestation", "readiness"],
  },
  {
    category: "discovery",
    feature: "manifests",
    capabilityPrefix: "manifest.",
    terms: ["manifest", "well-known", "discover", "catalog", "directory", "find agent"],
  },
  {
    category: "knowledge",
    feature: "gap-detection",
    terms: ["gap", "missing docs", "documentation", "faq", "answer", "ask", "knowledge"],
  },
  {
    category: "commerce",
    feature: "request-inbox",
    terms: ["inbox", "request", "task", "bounty", "marketplace", "order", "bid", "job"],
  },
  {
    category: "commerce",
    feature: "econ-ledger",
    terms: ["ledger", "revenue", "earning", "payout", "treasury"],
  },
  {
    category: "commerce",
    feature: "surveys",
    terms: ["survey", "poll", "questionnaire"],
  },
  {
    category: "integration",
    feature: "mcp-tools",
    capabilityPrefix: "mcp.",
    terms: ["mcp", "tool", "a2a", "sdk", "api", "webhook", "integration", "plugin"],
  },
  {
    category: "observability",
    terms: ["metric", "log", "trace", "monitor", "alert", "dashboard", "telemetry"],
  },
  {
    category: "security",
    terms: ["auth", "permission", "audit", "consent", "credential", "token"],
  },
  {
    category: "infrastructure",
    terms: ["deploy", "uptime", "rate limit", "rate-limit", "storage", "latency", "scale"],
  },
];

export interface DemandClassification {
  category: string | null;
  feature: string | null;
  capabilityKey: string | null;
}

// Inflection tolerance — the vocab uses singular base terms
// ("refund") but callers write plurals/tenses ("refunds",
// "refunded", "paying"). Arc 231 R2 L-8: bare `s?` missed every
// non-plural inflection; (s|es|d|ed|ing) restores substring-era
// recall without reopening inside-word false positives.
const termRe = (t: string): RegExp =>
  new RegExp(
    `(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s|es|d|ed|ing)?(?:[^a-z0-9]|$)`,
    "i",
  );

const RULE_RES = DEMAND_CLASSIFY_RULES.map((r) =>
  r.terms.map(termRe),
);

/** First-match deterministic classify — unclassified → all null. */
export function classifyDemandText(
  normalizedText: string,
): DemandClassification {
  for (let i = 0; i < DEMAND_CLASSIFY_RULES.length; i += 1) {
    const rule = DEMAND_CLASSIFY_RULES[i]!;
    if (RULE_RES[i]!.some((re) => re.test(normalizedText))) {
      return {
        category: rule.category,
        feature: rule.feature ?? null,
        capabilityKey: rule.capabilityPrefix
          ? `${rule.capabilityPrefix}${rule.feature ?? rule.category}`
          : null,
      };
    }
  }
  return { category: null, feature: null, capabilityKey: null };
}

/**
 * D-229-5-style drift probe — source-vocab terms (D-228-5 starters)
 * that no classify rule currently maps into a category. A growing
 * list = the upstream vocabulary moved and the demand dictionary
 * did not follow. Pure — no store access.
 */
export function demandDictDrift(): {
  uncoveredTopics: string[];
  uncoveredEntities: string[];
} {
  const covered = new Set(
    DEMAND_CLASSIFY_RULES.flatMap((r) => [
      r.category,
      ...(r.feature ? [r.feature] : []),
      ...r.terms,
    ]),
  );
  return {
    uncoveredTopics: STARTER_TOPICS.filter((t) => !covered.has(t)),
    uncoveredEntities: STARTER_ENTITIES.filter((e) => !covered.has(e)),
  };
}

/** Code-side dictionary manifest (D-229-5 collect* pattern). */
export function collectDemandDictionary(): {
  categories: readonly string[];
  features: readonly string[];
} {
  return {
    categories: DEMAND_CATEGORY_TERMS,
    features: DEMAND_FEATURE_TERMS,
  };
}
