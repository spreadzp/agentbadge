export interface ClusterPageData {
  slug: string;
  question: string;
  title: string;
  description: string;
  directAnswer: string;
  contentFile: string;
  relatedRuleIds: string[];
  relatedPages: string[];
  pillar: string;
}

export const CLUSTER_PAGES: ClusterPageData[] = [
  {
    slug: "how-to-make-an-api-agent-ready",
    question: "How to make an API agent-ready?",
    title: "How to Make an API Agent-Ready",
    description:
      "Step-by-step guide to making your API discoverable, understandable, and executable by AI agents. Covers robots.txt, llms.txt, agent guides, OpenAPI, structured errors, and more.",
    directAnswer:
      "Making an API agent-ready means ensuring AI agents can discover your API, understand what it does, and execute requests successfully. This requires machine-readable documentation (OpenAPI, llms.txt), clear authentication, structured error responses, and consistent behavior between docs and implementation.",
    contentFile: "src/server/cluster-content/how-to-make-an-api-agent-ready.md",
    relatedRuleIds: ["AB-001", "AB-002", "AB-003", "AB-004", "AB-014", "AB-016"],
    relatedPages: ["what-is-an-ai-ready-api", "openapi-vs-agent-readiness", "how-ai-agents-use-apis"],
    pillar: "discovery",
  },
  {
    slug: "agent-readiness-vs-seo",
    question: "Agent readiness vs SEO — what's the difference?",
    title: "Agent Readiness vs SEO",
    description:
      "SEO optimizes for search engines. Agent readiness optimizes for AI agents. They share some practices but differ in audience, format, and goals.",
    directAnswer:
      "SEO optimizes content for search engine crawlers and human searchers. Agent readiness optimizes APIs and services for AI agents that discover, understand, and execute requests autonomously. They share some practices (structured data, clear URLs) but serve different consumers with different needs.",
    contentFile: "src/server/cluster-content/agent-readiness-vs-seo.md",
    relatedRuleIds: ["AB-054", "AB-061", "AB-066", "AB-068"],
    relatedPages: ["agent-readiness-vs-geo", "what-is-an-ai-ready-api", "how-to-make-an-api-agent-ready"],
    pillar: "discovery",
  },
  {
    slug: "agent-readiness-vs-geo",
    question: "Agent readiness vs GEO — what's the difference?",
    title: "Agent Readiness vs GEO (Generative Engine Optimization)",
    description:
      "GEO optimizes content for AI-generated answers. Agent readiness ensures APIs are executable by AI agents. Related but distinct disciplines.",
    directAnswer:
      "GEO (Generative Engine Optimization) focuses on making content citable in AI-generated answers (ChatGPT, Perplexity, Google AI Overviews). Agent readiness focuses on making APIs and services executable by AI agents. GEO is about content visibility; agent readiness is about API usability.",
    contentFile: "src/server/cluster-content/agent-readiness-vs-geo.md",
    relatedRuleIds: ["AB-054", "AB-066", "AB-049"],
    relatedPages: ["agent-readiness-vs-seo", "what-is-an-ai-ready-api", "how-ai-agents-use-apis"],
    pillar: "discovery",
  },
  {
    slug: "openapi-vs-agent-readiness",
    question: "OpenAPI vs agent readiness — is OpenAPI enough?",
    title: "OpenAPI vs Agent Readiness",
    description:
      "OpenAPI is necessary but not sufficient for agent readiness. Agents need discovery, guides, error handling, and consistency beyond a spec file.",
    directAnswer:
      "OpenAPI is necessary but not sufficient for agent readiness. An OpenAPI spec describes endpoints, but agent readiness also requires discoverability (robots.txt, llms.txt), an agent guide, structured error responses, rate limit declarations, pricing information, and consistency between documentation and implementation.",
    contentFile: "src/server/cluster-content/openapi-vs-agent-readiness.md",
    relatedRuleIds: ["AB-004", "AB-007", "AB-012", "AB-011", "AB-010"],
    relatedPages: ["how-to-make-an-api-agent-ready", "what-is-an-ai-ready-api", "how-ai-agents-use-apis"],
    pillar: "understandability",
  },
  {
    slug: "what-is-an-ai-ready-api",
    question: "What is an AI-ready API?",
    title: "What is an AI-Ready API?",
    description:
      "An AI-ready API is one that AI agents can discover, understand, and use autonomously. It goes beyond REST design to include machine-readable metadata, agent guides, and consistent behavior.",
    directAnswer:
      "An AI-ready API is one that AI agents can discover, understand, and execute autonomously without human intervention. It has machine-readable documentation (OpenAPI, llms.txt), clear authentication, structured responses, consistent error handling, and is verified by a scanner like AgentBadge.",
    contentFile: "src/server/cluster-content/what-is-an-ai-ready-api.md",
    relatedRuleIds: ["AB-001", "AB-003", "AB-004", "AB-014", "AB-016"],
    relatedPages: ["how-to-make-an-api-agent-ready", "agent-readiness-vs-seo", "openapi-vs-agent-readiness"],
    pillar: "discovery",
  },
  {
    slug: "how-ai-agents-use-apis",
    question: "How do AI agents use APIs?",
    title: "How AI Agents Use APIs",
    description:
      "AI agents discover APIs via robots.txt and llms.txt, read OpenAPI specs and agent guides, authenticate, make requests, handle errors, and chain calls — all autonomously.",
    directAnswer:
      "AI agents use APIs by first discovering them (robots.txt, llms.txt, DNS records), then reading documentation (OpenAPI spec, agent guide), authenticating, making requests, interpreting responses, handling errors, and chaining multiple API calls to accomplish complex tasks — all without human intervention.",
    contentFile: "src/server/cluster-content/how-ai-agents-use-apis.md",
    relatedRuleIds: ["AB-001", "AB-003", "AB-004", "AB-008", "AB-012", "AB-015"],
    relatedPages: ["what-is-an-ai-ready-api", "how-to-make-an-api-agent-ready", "openapi-vs-agent-readiness"],
    pillar: "executability",
  },
];

export function getClusterPage(slug: string): ClusterPageData | undefined {
  return CLUSTER_PAGES.find((p) => p.slug === slug);
}
