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
    readingTime: "10 min",
    content: `<p><strong>Agent readiness</strong> is the measure of how easily an AI agent — whether an LLM, a crawler, or an autonomous system — can discover, understand, and interact with your API or website. It is the SEO equivalent for the agentic web: if your API is not agent-ready, AI agents simply cannot use it.</p>

<p>In 2026, AI agents are becoming primary consumers of the web. They search for APIs, read documentation, authenticate, make requests, and even pay for services — all without human intervention. But most APIs today are built for human developers, not machines. Agent readiness bridges that gap.</p>

<h2>Short Answer: What Does "Agent Ready" Mean?</h2>
<p>An API or website is <em>agent ready</em> when an AI agent can:</p>
<ol>
  <li><strong>Discover</strong> it — find the API endpoint, read its capabilities</li>
  <li><strong>Understand</strong> it — parse the schema, know what parameters are required</li>
  <li><strong>Authenticate</strong> — follow the auth flow without human help</li>
  <li><strong>Call</strong> it — make valid requests and parse responses</li>
  <li><strong>Handle errors</strong> — understand what went wrong and how to fix it</li>
  <li><strong>Pay</strong> — if the API requires payment, complete the transaction autonomously</li>
</ol>
<p>If any of these steps fails, the agent cannot use your API. That's what agent readiness measures.</p>

<h2>Why Agent Readiness Matters Now</h2>
<p>The web is splitting into two audiences: humans and agents. Humans use browsers, read rendered HTML, and click links. Agents use HTTP clients, parse JSON, and follow machine-readable manifests. If your API only serves humans, you're invisible to the fastest-growing segment of internet traffic.</p>

<p>Consider these trends:</p>
<ul>
  <li>LLMs like GPT-4, Claude, and Gemini can browse the web and call APIs — but only if those APIs are discoverable and machine-readable</li>
  <li>Autonomous agents like AutoGPT and Devin need structured endpoints to function</li>
  <li>Search engines are increasingly using AI to understand and recommend APIs</li>
  <li>The <a href="https://modelcontextprotocol.io">Model Context Protocol (MCP)</a> is standardizing how agents interact with tools</li>
</ul>

<p>Agent readiness is not a future concern. It's a present-day competitive advantage. APIs that are agent-ready get recommended by LLMs, indexed by AI search engines, and used by autonomous systems. APIs that aren't, don't.</p>

<h2>The 15 Categories of Agent Readiness</h2>
<p>AgentBadge's scanner evaluates your API across <strong>15 categories</strong> and <strong>72 individual checks</strong>. Here's what each category covers:</p>

<h3>1. Discovery</h3>
<p>Can agents find your API? This checks for:</p>
<ul>
  <li><code>/.well-known/</code> endpoints (RFC 8615)</li>
  <li><code>/openapi.json</code> or <code>/openapi.yaml</code> — OpenAPI specification</li>
  <li><code>/llms.txt</code> — LLM-readable summary</li>
  <li><code>/ai-sitemap.xml</code> — machine-readable sitemap</li>
  <li><code>Link</code> headers (RFC 8288) for resource discovery</li>
</ul>

<h3>2. Authentication</h3>
<p>Is authentication documented and machine-readable?</p>
<ul>
  <li>OAuth 2.0 discovery endpoints (RFC 8414, RFC 9728)</li>
  <li>API key documentation in OpenAPI security schemes</li>
  <li>Bearer token patterns</li>
  <li>Auth flow that an agent can follow without human intervention</li>
</ul>

<h3>3. Structured Data</h3>
<p>Does your API return structured, machine-readable data?</p>
<ul>
  <li>JSON-LD structured data on web pages</li>
  <li>schema.org types (Organization, Service, Product, FAQPage)</li>
  <li>Structured error responses with error codes and messages</li>
  <li>Content-Type negotiation (JSON, not just HTML)</li>
</ul>

<h3>4. Capability Description</h3>
<p>Can agents understand what your API does?</p>
<ul>
  <li>Clear API summary in OpenAPI</li>
  <li>Endpoint descriptions with examples</li>
  <li>Parameter documentation with types and constraints</li>
  <li>Response schema with field descriptions</li>
</ul>

<h3>5. Payment Integration</h3>
<p>If your API requires payment, can agents pay autonomously?</p>
<ul>
  <li><a href="/services/marketplace">x402 protocol</a> support for machine-to-machine payments</li>
  <li>Payment headers in HTTP responses</li>
  <li>Price discovery (how much does a call cost?)</li>
  <li>Escrow and settlement on-chain (HBAR)</li>
</ul>

<h3>6–15. Additional Categories</h3>
<p>The remaining categories cover:</p>
<ul>
  <li><strong>Content Negotiation</strong> — serving JSON, not just HTML</li>
  <li><strong>MCP Support</strong> — Model Context Protocol tool definitions</li>
  <li><strong>Agent Identity</strong> — agent passports, DIDs, HCS directory</li>
  <li><strong>Rate Limiting</strong> — documented and agent-friendly</li>
  <li><strong>Documentation</strong> — llms.txt, ai-plugin.json, skill files</li>
  <li><strong>Infrastructure</strong> — HTTPS, CORS, security headers</li>
  <li><strong>A2A Messaging</strong> — agent-to-agent communication</li>
  <li><strong>WebMCP</strong> — browser-side MCP tools</li>
  <li><strong>Bot Access</strong> — robots.txt allowing AI crawlers</li>
  <li><strong>Error Handling</strong> — deterministic, structured errors</li>
</ul>

<h2>How Agent Readiness Is Scored</h2>
<p>Each of the 72 checks produces one of three results:</p>
<ul>
  <li><strong>✓ Pass</strong> — The check succeeded. Your API meets this requirement.</li>
  <li><strong>✗ Fail</strong> — The check failed. This needs to be fixed.</li>
  <li><strong>◐ Partial</strong> — The check partially succeeded. Some work needed.</li>
</ul>

<p>Your <strong>AgentGrade</strong> is a weighted score from 0 to 100. Critical checks (discovery, authentication) carry more weight than nice-to-have checks. A score of:</p>
<ul>
  <li><strong>90–100</strong> — Excellent. Your API is fully agent-ready.</li>
  <li><strong>76–89</strong> — Good. Your API is agent-ready with minor gaps.</li>
  <li><strong>50–75</strong> — Fair. Significant work needed for agent readiness.</li>
  <li><strong>Below 50</strong> — Poor. Your API is not agent-ready.</li>
</ul>

<h2>How to Check Your Agent Readiness</h2>
<p>You can scan any API or website in seconds using the <a href="/services/scanner">AgentBadge Scanner</a>. The scanner:</p>
<ol>
  <li>Fetches your API endpoint and well-known files</li>
  <li>Runs all 72 checks across 15 categories</li>
  <li>Produces a detailed report with evidence and fix hints</li>
  <li>Calculates your AgentGrade score</li>
</ol>

<p>You can also use the CLI:</p>
<pre><code>$ agentbadge scan https://api.example.com
✓ discovery /openapi.json
✓ OpenAPI schema detected
✓ authentication documented
✗ structured error schema missing
◐ capability description inferred

AGENT READINESS 76 / 100
+8 after fix</code></pre>

<h2>From Agent Readiness to Agent Identity</h2>
<p>Once your API is agent-ready, the next step is giving your AI agents verifiable identity. <a href="/services/passports">Agent Passports</a> are NFT-based identity credentials on the Hedera network. They allow agents to:</p>
<ul>
  <li>Prove who they are with a DID (<code>did:hcs</code>)</li>
  <li>Register in the public HCS directory for agent-to-agent discovery</li>
  <li>Build trust through tiered capabilities (Bronze → Platinum)</li>
  <li>Participate in the <a href="/services/marketplace">task marketplace</a> with x402 machine payments</li>
</ul>

<h2>The Agent-Ready Stack</h2>
<p>Agent readiness is the foundation. On top of it, you build:</p>
<ol>
  <li><strong>Discovery</strong> → Agents find your API</li>
  <li><strong>Identity</strong> → Agents prove who they are (passports)</li>
  <li><strong>Commerce</strong> → Agents pay and get paid (marketplace)</li>
</ol>

<p>This is the stack that AgentBadge provides. Start with a <a href="/services/scanner">free scan</a>, get your AgentGrade, fix the gaps, and join the agentic web.</p>

<h2>Further Reading</h2>
<ul>
  <li><a href="/agent-guide">Agent Guide</a> — complete documentation for agent-ready infrastructure</li>
  <li><a href="/faq">FAQ</a> — common questions about agent readiness and AgentBadge</li>
  <li><a href="/pricing">Pricing</a> — passport tiers and capabilities</li>
</ul>`,
  },
];
