export interface ComparisonFeature {
  feature: string;
  agentbadge: string;
  tool: string;
}

export interface ComparisonPageData {
  slug: string;
  /** Short tool name used in tables and headings, e.g. "MCP". */
  tool: string;
  title: string;
  /** H1 phrased as the reader's question. */
  question: string;
  description: string;
  /** One-line "so which should I use" conclusion. */
  verdict: string;
  contentFile: string;
  markdown: string;
  /** Slugs of other comparison pages — must exist in COMPARISON_PAGES. */
  relatedPages: string[];
  /** Rows for the "Feature comparison" table. */
  features: ComparisonFeature[];
}

export const COMPARISON_PAGES: ComparisonPageData[] = [
  {
    slug: "agentbadge-vs-mcp",
    tool: "MCP",
    title: "AgentBadge vs MCP",
    question: "AgentBadge vs MCP — do I need both?",
    description:
      "MCP connects agents to tools. AgentBadge measures and certifies API readiness. They're complementary.",
    verdict:
      "Complementary, not competing. MCP is the connection layer; AgentBadge verifies the API is worth connecting to.",
    contentFile: "src/server/comparison-content/agentbadge-vs-mcp.md",
    markdown: "",
    relatedPages: ["agentbadge-vs-postman", "agentbadge-vs-swagger"],
    features: [
      { feature: "Primary purpose", agentbadge: "Certify API readiness for AI agents", tool: "Connect agents to tools/data" },
      { feature: "Readiness score", agentbadge: "Yes — weighted ruleset score", tool: "No scoring" },
      { feature: "Tool invocation", agentbadge: "No — checks whether calls will work", tool: "Yes — protocol for calling tools" },
      { feature: "Discovery checks", agentbadge: "robots.txt, llms.txt, sitemap", tool: "Out of scope" },
    ],
  },
  {
    slug: "agentbadge-vs-postman",
    tool: "Postman",
    title: "AgentBadge vs Postman",
    question: "AgentBadge vs Postman — which one checks agent readiness?",
    description:
      "Postman tests APIs. AgentBadge certifies API readiness for AI agents. Different goals, complementary tools.",
    verdict:
      "Different goals. Postman proves your API works; AgentBadge proves AI agents can find, understand, and use it.",
    contentFile: "src/server/comparison-content/agentbadge-vs-postman.md",
    markdown: "",
    relatedPages: ["agentbadge-vs-mcp", "agentbadge-vs-swagger"],
    features: [
      { feature: "Primary purpose", agentbadge: "Certify API readiness for AI agents", tool: "Manual/API testing for humans" },
      { feature: "Audience", agentbadge: "AI agents + their operators", tool: "Developers + QA" },
      { feature: "What gets checked", agentbadge: "Discovery, docs, auth, errors, pricing", tool: "Request/response correctness" },
      { feature: "Output", agentbadge: "Score + badge + fix hints", tool: "Test results" },
    ],
  },
  {
    slug: "agentbadge-vs-swagger",
    tool: "Swagger / OpenAPI",
    title: "AgentBadge vs Swagger",
    question: "AgentBadge vs Swagger — is an OpenAPI spec enough?",
    description:
      "Swagger documents APIs for humans. AgentBadge certifies APIs are ready for AI agents. OpenAPI is necessary but not sufficient.",
    verdict:
      "OpenAPI is necessary, not sufficient. Swagger describes your API; AgentBadge verifies agents can actually use it.",
    contentFile: "src/server/comparison-content/agentbadge-vs-swagger.md",
    markdown: "",
    relatedPages: ["agentbadge-vs-mcp", "agentbadge-vs-postman"],
    features: [
      { feature: "Primary purpose", agentbadge: "Certify API readiness for AI agents", tool: "Document API structure" },
      { feature: "Verification", agentbadge: "Live checks against the running site", tool: "Static spec — no runtime checks" },
      { feature: "Coverage", agentbadge: "Docs + discovery + pricing + errors", tool: "Endpoints, schemas, auth" },
      { feature: "Agent discovery", agentbadge: "robots.txt, llms.txt, .well-known", tool: "Not covered" },
    ],
  },
];

export function getComparisonPage(slug: string): ComparisonPageData | undefined {
  return COMPARISON_PAGES.find((p) => p.slug === slug);
}
