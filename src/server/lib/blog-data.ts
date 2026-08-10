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
  {
    slug: "mcp-vs-api",
    title: "MCP vs API: Agent Tools 2026",
    description:
      "Model Context Protocol (MCP) is replacing REST APIs as the primary way AI agents interact with services. Compare MCP vs REST API, when to use each, and how to make your API agent-ready.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-10",
    tags: ["mcp", "api", "agent-tools", "model-context-protocol"],
    readingTime: "9 min",
    content: `<p><strong>Model Context Protocol (MCP)</strong> is a new standard that defines how AI agents interact with external tools and services. It's not a replacement for REST APIs — it's a layer on top of them that makes APIs agent-native. But in 2026, the question isn't whether to use MCP or REST. It's how to make both work together for the agentic web.</p>

<p>If you're building an API that AI agents will use, you need to understand MCP. This article explains what MCP is, how it differs from traditional REST APIs, when to use each, and how to make your API agent-ready with both.</p>

<h2>Short Answer: MCP vs API</h2>
<p><strong>REST API</strong> is how services communicate over HTTP — stateless, resource-oriented, human-designed endpoints. <strong>MCP</strong> is how AI agents discover and call those endpoints — a protocol layer that provides tool definitions, schema validation, and structured responses optimized for LLM consumption.</p>

<p>Think of it this way: REST is the road. MCP is the GPS. Agents need both.</p>

<h2>What Is the Model Context Protocol?</h2>
<p>MCP is an open protocol (introduced by Anthropic in 2024) that standardizes how AI models interact with external tools. It defines:</p>
<ul>
  <li><strong>Tool definitions</strong> — machine-readable descriptions of what a tool does, its parameters, and return types</li>
  <li><strong>Transport</strong> — how the agent connects to the tool server (stdio, SSE, HTTP)</li>
  <li><strong>Schema validation</strong> — JSON Schema for input/output validation</li>
  <li><strong>Resource access</strong> — reading files, databases, or API endpoints through a unified interface</li>
</ul>

<p>An MCP server exposes tools. An MCP client (like Claude, Cursor, or any LLM agent) discovers those tools and can call them. The protocol handles the negotiation, validation, and response formatting.</p>

<h2>REST API: The Foundation</h2>
<p>REST APIs have been the standard for web services for over 15 years. They work like this:</p>
<pre><code>GET /api/users/123
Authorization: Bearer sk-...

200 OK
Content-Type: application/json

{"id": 123, "name": "Alice", "email": "alice@example.com"}</code></pre>

<p>REST is:</p>
<ul>
  <li><strong>Stateless</strong> — each request contains all needed information</li>
  <li><strong>Resource-oriented</strong> — URLs represent resources (/users, /orders)</li>
  <li><strong>Human-designed</strong> — endpoints are designed by developers for developers</li>
  <li><strong>HTTP-based</strong> — uses standard HTTP methods (GET, POST, PUT, DELETE)</li>
</ul>

<p>REST is perfect for human developers who read documentation, understand the schema, and write code to call the API. But for AI agents, REST has limitations:</p>
<ul>
  <li>Agents need to <em>discover</em> endpoints — REST doesn't self-describe</li>
  <li>Agents need to <em>understand</em> parameters — REST relies on external docs (OpenAPI)</li>
  <li>Agents need to <em>handle errors</em> — REST error formats are inconsistent</li>
</ul>

<h2>MCP: The Agent Layer</h2>
<p>MCP solves these problems by adding a machine-readable layer on top of your API. An MCP server exposes tools like this:</p>
<pre><code>{
  "tools": [
    {
      "name": "get_user",
      "description": "Get user profile by ID",
      "inputSchema": {
        "type": "object",
        "properties": {
          "user_id": {"type": "integer", "description": "User ID"}
        },
        "required": ["user_id"]
      }
    }
  ]
}</code></pre>

<p>The agent reads this definition, understands what the tool does, what parameters it needs, and can call it directly. No documentation reading. No guessing. The protocol handles everything.</p>

<h2>MCP vs REST: Key Differences</h2>
<table>
  <thead>
    <tr><th>Feature</th><th>REST API</th><th>MCP</th></tr>
  </thead>
  <tbody>
    <tr><td>Discovery</td><td>External (OpenAPI, docs)</td><td>Built-in (tool list)</td></tr>
    <tr><td>Schema</td><td>OpenAPI (separate file)</td><td>JSON Schema (inline)</td></tr>
    <tr><td>Transport</td><td>HTTP only</td><td>stdio, SSE, HTTP</td></tr>
    <tr><td>State</td><td>Stateless</td><td>Stateful sessions</td></tr>
    <tr><td>Audience</td><td>Human developers</td><td>AI agents / LLMs</td></tr>
    <tr><td>Error handling</td><td>HTTP status codes</td><td>Structured error objects</td></tr>
    <tr><td>Authentication</td><td>Bearer tokens, OAuth</td><td>Same + session-based</td></tr>
  </tbody>
</table>

<h2>When to Use MCP vs REST</h2>
<h3>Use REST when:</h3>
<ul>
  <li>You're building a public API for human developers</li>
  <li>You need maximum compatibility (webhooks, mobile apps, server-to-server)</li>
  <li>You're serving high-volume automated requests</li>
  <li>You need caching at the HTTP layer</li>
</ul>

<h3>Use MCP when:</h3>
<ul>
  <li>You want AI agents (Claude, GPT, Gemini) to use your service</li>
  <li>You're building tools for autonomous agents (AutoGPT, Devin)</li>
  <li>You want LLMs to discover your capabilities automatically</li>
  <li>You need structured, validated tool calls</li>
</ul>

<h3>Use both when:</h3>
<ul>
  <li>You have a REST API and want to make it agent-ready</li>
  <li>You're building a new service that serves both humans and agents</li>
</ul>

<p>This is the most common case in 2026. You keep your REST API and add an MCP server on top. The MCP server wraps your existing endpoints and exposes them as agent-friendly tools.</p>

<h2>How to Make Your API Agent-Ready</h2>
<p>Whether you use MCP or REST (or both), your API needs to be <a href="/blog/what-is-agent-readiness">agent-ready</a>. This means:</p>
<ol>
  <li><strong>Provide an OpenAPI spec</strong> at <code>/openapi.json</code> — so agents can discover your endpoints</li>
  <li><strong>Provide an MCP server</strong> — so agents can call your tools with schema validation</li>
  <li><strong>Provide <code>llms.txt</code></strong> — so LLMs can understand your service at a glance</li>
  <li><strong>Use structured error responses</strong> — so agents can handle failures deterministically</li>
  <li><strong>Document authentication</strong> — so agents can auth without human help</li>
</ol>

<p>You can check all of these with the <a href="/services/scanner">AgentBadge Scanner</a> — it runs 72 checks across 15 categories and gives you an AgentGrade score.</p>

<h2>MCP Server Example</h2>
<p>Here's a minimal MCP server that wraps a REST API:</p>
<pre><code>import { McpServer } from "@modelcontextprotocol/sdk";

const server = new McpServer({
  name: "my-api",
  version: "1.0.0",
});

server.tool(
  "get_user",
  "Get user profile by ID",
  { user_id: { type: "number" } },
  async ({ user_id }) => {
    const res = await fetch(\`https://api.example.com/users/\${user_id}\`, {
      headers: { Authorization: \`Bearer \${process.env.API_KEY}\` },
    });
    return { content: [{ type: "text", text: JSON.stringify(await res.json()) }] };
  }
);

server.run({ transportType: "stdio" });</code></pre>

<p>This MCP server wraps a REST endpoint. The agent discovers the tool, validates the input, calls the REST API, and returns the result — all without reading any documentation.</p>

<h2>WebMCP: The Browser Frontier</h2>
<p>A new evolution of MCP is <strong>WebMCP</strong> — running MCP servers in the browser. This allows web pages to expose tools directly to AI agents without a backend server. The browser becomes the MCP transport.</p>

<p>WebMCP is particularly useful for:</p>
<ul>
  <li>SaaS apps that want to expose in-app actions to AI assistants</li>
  <li>Browser extensions that augment agent capabilities</li>
  <li>Progressive web apps that serve as agent tools</li>
</ul>

<h2>The Future: Agent-Native APIs</h2>
<p>In 2026, the best APIs are agent-native. They provide:</p>
<ol>
  <li><strong>REST</strong> for human developers and server-to-server</li>
  <li><strong>MCP</strong> for AI agents and LLMs</li>
  <li><strong>OpenAPI</strong> for discovery</li>
  <li><strong>llms.txt</strong> for LLM consumption</li>
  <li><strong>x402</strong> for machine payments (if monetized)</li>
</ol>

<p>This stack is what we call <a href="/blog/what-is-agent-readiness">agent readiness</a>. And you can verify yours with a <a href="/services/scanner">free scan</a> from AgentBadge.</p>

<h2>Further Reading</h2>
<ul>
  <li><a href="/agent-guide">Agent Guide</a> — complete documentation for agent-ready infrastructure</li>
  <li><a href="/blog/what-is-agent-readiness">What is Agent Readiness?</a> — the foundation article</li>
  <li><a href="https://modelcontextprotocol.io">MCP specification</a> — official protocol docs</li>
  <li><a href="/services/scanner">AgentBadge Scanner</a> — check your API's agent readiness</li>
</ul>`,
  },
];
