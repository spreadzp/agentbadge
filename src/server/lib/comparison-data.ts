export interface ComparisonPageData {
  slug: string;
  title: string;
  description: string;
  contentFile: string;
  markdown: string;
}

export const COMPARISON_PAGES: ComparisonPageData[] = [
  {
    slug: "agentbadge-vs-mcp",
    title: "AgentBadge vs MCP",
    description:
      "MCP connects agents to tools. AgentBadge measures and certifies API readiness. They're complementary.",
    contentFile: "src/server/comparison-content/agentbadge-vs-mcp.md",
    markdown: "",
  },
  {
    slug: "agentbadge-vs-postman",
    title: "AgentBadge vs Postman",
    description:
      "Postman tests APIs. AgentBadge certifies API readiness for AI agents. Different goals, complementary tools.",
    contentFile: "src/server/comparison-content/agentbadge-vs-postman.md",
    markdown: "",
  },
  {
    slug: "agentbadge-vs-swagger",
    title: "AgentBadge vs Swagger",
    description:
      "Swagger documents APIs for humans. AgentBadge certifies APIs are ready for AI agents. OpenAPI is necessary but not sufficient.",
    contentFile: "src/server/comparison-content/agentbadge-vs-swagger.md",
    markdown: "",
  },
];

export function getComparisonPage(slug: string): ComparisonPageData | null {
  return COMPARISON_PAGES.find((p) => p.slug === slug) ?? null;
}
