/**
 * SLICE-259-14 (D-259-Q3, GPT Q20): robots.txt is generated, not
 * hand-edited. CRAWL_POLICY is the single declarative source — each row
 * maps a path pattern → content class → per-bot-class decision —
 * and renderRobotsTxt() emits the file. A named User-agent group fully
 * replaces `*` for that bot (robots semantics), so every generated
 * non-`*` group repeats the base disallows.
 */

export type ContentClass =
  | "marketing"
  | "blog"
  | "api-docs"
  | "rules"
  | "knowledge"
  | "agent-guide"
  | "user-generated"
  | "sensitive";

export type BotClass = "default" | "search" | "training" | "user" | "seo";
export type Decision = "allow" | "disallow";

export interface CrawlPolicy {
  /** robots.txt path pattern (`*` and `$` metachars allowed). */
  path: string;
  contentClass: ContentClass;
  /** Decision for unknown bots (`User-agent: *`). */
  default: Decision;
  /** Search/answer crawlers (Googlebot, OAI-SearchBot, PerplexityBot…). */
  search: Decision;
  /** AI-training crawlers (GPTBot, ClaudeBot, CCBot…). */
  training: Decision;
  /** User-triggered fetchers (ChatGPT-User, Claude-User…). */
  user: Decision;
}

/**
 * Official UA tokens per class. `default` is the `*` group; `seo` bots
 * are blocked wholesale (high-load link-analysers, zero agentic value).
 * Extended tokens (Google-Extended, Applebot-Extended) are usage-
 * control signals, not crawlers — they sit in `training` per D-259-Q3.
 */
export const BOT_CLASSES: Record<Exclude<BotClass, "default">, string[]> = {
  search: [
    "Googlebot",
    "bingbot",
    "OAI-SearchBot",
    "Claude-SearchBot",
    "PerplexityBot",
    "DuckAssistBot",
    "Applebot",
    "Google-Agent",
    "Google-CloudVertexBot",
  ],
  training: [
    "GPTBot",
    "ClaudeBot",
    "CCBot",
    "Meta-ExternalAgent",
    "Meta-ExternalFetcher",
    "Google-Extended",
    "Applebot-Extended",
    "cohere-ai",
    "Amazonbot",
  ],
  user: [
    "ChatGPT-User",
    "Claude-User",
    "Perplexity-User",
    "MistralAI-User",
    "DuckDuckBot",
  ],
  seo: [
    "AhrefsBot",
    "SemrushBot",
    "SemrushBot-SA",
    "MJ12bot",
    "DotBot",
    "BLEXBot",
    "Bytespider",
  ],
};

const A = "allow" as const;
const D = "disallow" as const;

/**
 * The policy matrix — reviewed artifact, keep rows grouped by class.
 * `default` (`*`) doubles as the search/user baseline: those columns
 * only diverge on rows where that bot class is special.
 */
export const CRAWL_POLICY: CrawlPolicy[] = [
  // ── everything else (marketing, blog, agent-guide) — open default ─
  { path: "/", contentClass: "marketing", default: A, search: A, training: A, user: A },

  // ── sensitive: nobody but a same-origin browser ─────────────────
  { path: "/admin", contentClass: "sensitive", default: D, search: D, training: D, user: D },
  { path: "/ui/", contentClass: "sensitive", default: D, search: D, training: D, user: D },

  // ── API: JSON endpoints, not indexable — with the read-only allows
  //    advertised in llms.txt / agent-card (longest-match wins over
  //    the /api/ disallow). ─────────────────────────────────────────
  { path: "/api/", contentClass: "api-docs", default: D, search: D, training: D, user: D },
  { path: "/api/specs", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/catalog", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/search", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/start-here", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/meta/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  // SLICE-259-15: public rate-limited read — 429s in traffic are
  // agents hitting it, which is exactly who it's for.
  { path: "/api/v1/agent/knowledge/search", contentClass: "api-docs", default: A, search: A, training: A, user: A },

  // ── SLICE-259-33 (F6): public agent-facing API surface advertised
  //    in llms.txt — prefix allows for read-mostly namespaces +
  //    individual rows for top-level endpoints. Internal ops/ledger/
  //    intel surfaces stay under the /api/ disallow. ────────────────
  { path: "/api/v1/services", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/v1/catalog/products", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/v1/agents/register", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/v1/demo/scan-lite", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/attestcoin/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/board/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/commerce/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/demo/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/eaas/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/fx-delta/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/keeperhub/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/market/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/pay/gateway/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/payment/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/requests", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/surveys/open", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/tasks/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/venue/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/agent/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/attestations", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/audit", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/badge", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/benchmarks", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/bounties", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/corpus/stats", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/demand/request", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/gec/callback", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/health", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/indexnow", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/link-graph", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/passport/", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/scan-packs", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  { path: "/api/work-requests", contentClass: "api-docs", default: A, search: A, training: A, user: A },

  // ── rules corpus: indexable for humans/agents, but NOT a training
  //    set — the ruleset is the product (D-259-Q6 selective-train). ──
  { path: "/api/rules", contentClass: "rules", default: A, search: A, training: D, user: A },
  { path: "/rules", contentClass: "rules", default: A, search: A, training: D, user: A },
  { path: "/rules/", contentClass: "rules", default: A, search: A, training: D, user: A },

  // ── knowledge objects: machine-readable twins, kept out of training
  //    until the /knowledge/ migration lands (D-259-Q6). ────────────
  { path: "/blog/*.json", contentClass: "knowledge", default: A, search: A, training: D, user: A },

  // ── a2a / agents APIs + market tasks: machine surfaces, not pages ─
  { path: "/a2a/", contentClass: "user-generated", default: D, search: D, training: D, user: D },
  { path: "/a2a/challenge", contentClass: "api-docs", default: A, search: A, training: A, user: A },
  // `/agents$` + `/agents/` — plain `/agents` would also swallow
  // /agents.txt and /agents.json (audit finding, fixed pattern).
  { path: "/agents$", contentClass: "user-generated", default: D, search: D, training: D, user: D },
  { path: "/agents/", contentClass: "user-generated", default: D, search: D, training: D, user: D },
  { path: "/market/tasks/", contentClass: "user-generated", default: D, search: D, training: D, user: D },
];

export interface RobotsOptions {
  baseUrl: string;
  sitemaps?: string[];
  /** Absolute off-site sitemap URLs (e.g. the GitBook docs sitemap) —
   *  emitted verbatim, not prefixed with baseUrl. */
  externalSitemaps?: string[];
}

/** Effective decision for a bot class on one policy row. */
function decisionFor(
  p: CrawlPolicy,
  cls: Exclude<BotClass, "seo">,
): Decision {
  return cls === "default" ? p.default : p[cls];
}

function rulesFor(cls: Exclude<BotClass, "seo">): string[] {
  // `*` is the baseline group. Named classes (search/training/user)
  // replicate the `*` decisions and apply their own overrides —
  // a named group replaces `*` entirely, never merges with it.
  const out: string[] = [];
  for (const p of CRAWL_POLICY) {
    const d = decisionFor(p, cls);
    out.push(`${d === "allow" ? "Allow" : "Disallow"}: ${p.path}`);
  }
  return out;
}

export function renderRobotsTxt(opts: RobotsOptions): string {
  const sitemaps = opts.sitemaps ?? ["/sitemap.xml", "/ai-sitemap.xml"];
  const lines: string[] = [
    "# robots.txt — GENERATED from src/server/lib/crawl-policy.ts",
    "# Do not hand-edit; change the matrix and re-render (SLICE-259-14).",
    "",
    "User-agent: *",
    ...rulesFor("default"),
    "Crawl-delay: 1",
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "",
    "# AI-training crawlers: welcome — except the rules corpus and",
    "# Knowledge Objects (product IP / pending /knowledge/ migration).",
    ...BOT_CLASSES.training.map((b) => `User-agent: ${b}`),
    ...rulesFor("training"),
    "",
    "# SEO-tool / high-load crawlers — full block.",
    ...BOT_CLASSES.seo.map((b) => `User-agent: ${b}`),
    "Disallow: /",
    "",
    ...sitemaps.map((s) => `Sitemap: ${opts.baseUrl}${s}`),
    ...(opts.externalSitemaps ?? []).map((s) => `Sitemap: ${s}`),
    "",
  ];
  return lines.join("\n");
}
