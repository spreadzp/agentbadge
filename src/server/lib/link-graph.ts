import { PageMeta } from "./page-meta";
import { BLOG_ARTICLES } from "./blog-data";
import { AGENT_READINESS_RULESET } from "../../agent-readiness/ruleset";

export interface LinkGraphNode {
  url: string;
  title: string;
  type:
  | "homepage"
  | "blog"
  | "blog-article"
  | "faq"
  | "about"
  | "pricing"
  | "use-cases"
  | "rules"
  | "rule"
  | "services"
  | "service"
  | "changelog"
  | "legal"
  | "guide"
  | "authority";
}

export interface LinkGraphEdge {
  from: string;
  to: string;
  relationship: "navigation" | "related" | "breadcrumb" | "contextual" | "cta";
}

const NODE_TYPE_MAP: Record<string, LinkGraphNode["type"]> = {
  "/": "homepage",
  "/blog": "blog",
  "/faq": "faq",
  "/about": "about",
  "/pricing": "pricing",
  "/use-cases": "use-cases",
  "/rules": "rules",
  "/services": "services",
  "/changelog": "changelog",
  "/terms": "legal",
  "/privacy": "legal",
  "/agent-guide": "guide",
};

function pathToNodeType(path: string): LinkGraphNode["type"] {
  if (NODE_TYPE_MAP[path]) return NODE_TYPE_MAP[path];
  if (path.startsWith("/blog/")) return "blog-article";
  if (path.startsWith("/rules/")) return "rule";
  if (path.startsWith("/services/")) return "service";
  return "guide";
}

const FOOTER_NAV_LINKS: { from: string; to: string }[] = [
  { from: "/", to: "/blog" },
  { from: "/", to: "/faq" },
  { from: "/", to: "/about" },
  { from: "/", to: "/pricing" },
  { from: "/", to: "/use-cases" },
  { from: "/", to: "/rules" },
  { from: "/", to: "/services" },
  { from: "/", to: "/changelog" },
  { from: "/", to: "/agent-guide" },
  { from: "/blog", to: "/" },
  { from: "/faq", to: "/" },
  { from: "/about", to: "/" },
  { from: "/pricing", to: "/" },
  { from: "/use-cases", to: "/" },
  { from: "/rules", to: "/" },
  { from: "/services", to: "/" },
  { from: "/changelog", to: "/" },
];

const CONTEXTUAL_LINKS: { from: string; to: string }[] = [
  { from: "/", to: "/blog" },
  { from: "/", to: "/faq" },
  { from: "/", to: "/use-cases" },
  { from: "/", to: "/what-is-agent-readiness" },
  { from: "/faq", to: "/about" },
  { from: "/faq", to: "/pricing" },
  { from: "/faq", to: "/use-cases" },
  { from: "/faq", to: "/blog" },
  { from: "/about", to: "/blog" },
  { from: "/about", to: "/faq" },
  { from: "/about", to: "/pricing" },
  { from: "/about", to: "/services" },
  { from: "/pricing", to: "/faq" },
  { from: "/pricing", to: "/about" },
  { from: "/pricing", to: "/services" },
  { from: "/pricing", to: "/agent-guide" },
  { from: "/use-cases", to: "/services" },
  { from: "/use-cases", to: "/faq" },
  { from: "/use-cases", to: "/blog" },
  { from: "/use-cases", to: "/agent-guide" },
  { from: "/rules", to: "/faq" },
  { from: "/rules", to: "/agent-guide" },
  { from: "/rules", to: "/blog" },
  { from: "/services", to: "/about" },
  { from: "/services", to: "/faq" },
  { from: "/services", to: "/pricing" },
  { from: "/services", to: "/work-with-us" },
  { from: "/changelog", to: "/blog" },
  { from: "/changelog", to: "/agent-guide" },
];

const SERVICE_CROSS_LINKS: { from: string; to: string }[] = [
  { from: "/services/scanner", to: "/services/passports" },
  { from: "/services/scanner", to: "/services/marketplace" },
  { from: "/services/scanner", to: "/faq" },
  { from: "/services/scanner", to: "/pricing" },
  { from: "/services/passports", to: "/services/scanner" },
  { from: "/services/passports", to: "/services/marketplace" },
  { from: "/services/passports", to: "/faq" },
  { from: "/services/passports", to: "/pricing" },
  { from: "/services/marketplace", to: "/services/scanner" },
  { from: "/services/marketplace", to: "/services/passports" },
  { from: "/services/marketplace", to: "/faq" },
  { from: "/services/marketplace", to: "/pricing" },
];

export function buildLinkGraph(): { nodes: LinkGraphNode[]; edges: LinkGraphEdge[] } {
  const nodes: LinkGraphNode[] = [];
  const nodeUrls = new Set<string>();

  function addNode(url: string, title: string, type: LinkGraphNode["type"]) {
    if (nodeUrls.has(url)) return;
    nodeUrls.add(url);
    nodes.push({ url, title, type });
  }

  for (const [path, meta] of Object.entries(PageMeta)) {
    addNode(path, meta.title, pathToNodeType(path));
  }

  for (const article of BLOG_ARTICLES) {
    addNode(`/blog/${article.slug}`, article.title, "blog-article");
  }

  for (const rule of AGENT_READINESS_RULESET.rules) {
    addNode(`/rules/${rule.rule_id}`, rule.rule_id, "rule");
  }

  const edges: LinkGraphEdge[] = [];

  for (const { from, to } of FOOTER_NAV_LINKS) {
    edges.push({ from, to, relationship: "navigation" });
  }

  for (const { from, to } of CONTEXTUAL_LINKS) {
    edges.push({ from, to, relationship: "contextual" });
  }

  for (const { from, to } of SERVICE_CROSS_LINKS) {
    edges.push({ from, to, relationship: "contextual" });
  }

  for (const article of BLOG_ARTICLES) {
    const articleUrl = `/blog/${article.slug}`;
    if (article.relatedLinks) {
      for (const link of article.relatedLinks) {
        edges.push({ from: articleUrl, to: link.href, relationship: "related" });
      }
    }
    edges.push({ from: articleUrl, to: "/blog", relationship: "breadcrumb" });
    edges.push({ from: "/blog", to: articleUrl, relationship: "navigation" });
  }

  for (const rule of AGENT_READINESS_RULESET.rules) {
    const ruleUrl = `/rules/${rule.rule_id}`;
    edges.push({ from: ruleUrl, to: "/rules", relationship: "breadcrumb" });
    edges.push({ from: "/rules", to: ruleUrl, relationship: "navigation" });
  }

  return { nodes, edges };
}
