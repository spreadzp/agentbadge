export interface BlogArticle {
  slug: string;
  title: string;
  description: string;
  author: string;
  authorRole: string;
  date: string;
  tags: string[];
  readingTime: string;
  content: string;
}

export const BLOG_ARTICLES: BlogArticle[] = [
  {
    slug: "what-is-agent-readiness",
    title: "What is Agent Readiness?",
    description:
      "Agent readiness measures how easily an AI agent can discover, understand, and use your API or website. Learn the 72 checks that determine your AgentGrade score.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-10",
    tags: ["agent-readiness", "seo", "geo", "aeo"],
    readingTime: "8 min",
    content: `<p>Agent readiness is the measure of how easily an AI agent — whether an LLM, a crawler, or an autonomous system — can discover, understand, and interact with your API or website.</p>

<h2>Why Agent Readiness Matters</h2>
<p>As AI agents become primary consumers of the web, traditional SEO is no longer enough. Your API needs to be not just human-readable but <strong>agent-readable</strong>. This means machine-readable manifests, structured data, clear authentication, and deterministic error handling.</p>

<h2>The 72 Checks</h2>
<p>AgentBadge's scanner evaluates your API across 15 categories and 72 individual checks:</p>
<ul>
  <li><strong>Discovery</strong> — Can agents find your API? (OpenAPI, llms.txt, well-known endpoints)</li>
  <li><strong>Authentication</strong> — Is auth documented and machine-readable?</li>
  <li><strong>Structured Data</strong> — JSON-LD, schema.org, structured error responses</li>
  <li><strong>Capability Description</strong> — Can agents understand what your API does?</li>
  <li><strong>Payment Integration</strong> — x402 protocol, machine-to-machine payments</li>
</ul>

<h2>How to Score</h2>
<p>Each check produces a pass, fail, or partial result. Your AgentGrade is a weighted score from 0 to 100. A score of 76+ means your API is agent-ready.</p>

<h2>Start Scanning</h2>
<p>Run a free scan at <a href="/services/scanner">AgentBadge Scanner</a> and get your AgentGrade in seconds.</p>`,
  },
];
