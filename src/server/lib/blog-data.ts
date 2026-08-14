export interface BlogExternalLink {
  platform:
  | "devto"
  | "medium"
  | "linkedin"
  | "hackernews"
  | "hackernoon"
  | "reddit"
  | "github"
  | "hashnode"
  | "twitter";
  url: string;
}

export interface BlogArticle {
  slug: string;
  title: string;
  description: string;
  author: string;
  authorRole: string;
  date: string;
  dateModified?: string;
  tags: string[];
  readingTime: string;
  content: string;
  markdown?: string;
  agentGuideSlug?: string;
  heroImage?: string;
  ogImage?: string;
  externalLinks?: BlogExternalLink[];
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
    agentGuideSlug: "what-is-agent-readiness",
    heroImage: "/images/blog/what-is-agent-readiness-hero.png",
    ogImage: "/images/blog/what-is-agent-readiness-og.png",
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
  {
    slug: "x402-payments",
    title: "x402: Machine-to-Machine Payments for the Agentic Web",
    description:
      "The x402 protocol enables AI agents to pay for API calls autonomously using HTTP 402 Payment Required. Learn how machine-to-machine payments work with HBAR on Hedera.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-10",
    tags: ["x402", "payments", "hbar", "hedera", "machine-to-machine"],
    readingTime: "9 min",
    content: `<p><strong>x402</strong> is a payment protocol that enables machine-to-machine payments over HTTP. It uses the <code>402 Payment Required</code> HTTP status code — which has been part of the HTTP specification since 1991 but was never used — to signal that an API request requires payment. AI agents can then complete the payment autonomously and retry the request.</p>

<p>For the agentic web, x402 is essential. Without it, AI agents hit a paywall and stop — they can't pull out a credit card or enter billing details. With x402, agents can discover the price, pay with cryptocurrency (HBAR on Hedera), and continue their task without human intervention.</p>

<h2>Short Answer: What Is x402?</h2>
<p>x402 is a protocol where:</p>
<ol>
  <li>An agent calls an API endpoint</li>
  <li>The server responds with <code>402 Payment Required</code> and a payment header</li>
  <li>The agent reads the price and payment address from the header</li>
  <li>The agent sends a cryptocurrency payment (HBAR)</li>
  <li>The agent retries the request with proof of payment</li>
  <li>The server validates the payment and returns the data</li>
</ol>
<p>It's like a vending machine for APIs. Insert coin, get data.</p>

<h2>Why Machine-to-Machine Payments Matter</h2>
<p>The internet runs on payments. Humans pay with credit cards, Apple Pay, and bank transfers. But AI agents can't use any of these — they don't have credit cards, they can't fill out forms, and they can't call banks. They need a payment method that is:</p>
<ul>
  <li><strong>Autonomous</strong> — no human intervention required</li>
  <li><strong>Instant</strong> — sub-second settlement</li>
  <li><strong>Programmable</strong> — conditional, escrowed, or recurring</li>
  <li><strong>Low-cost</strong> — micropayments for small API calls</li>
  <li><strong>Global</strong> — no banking restrictions</li>
</ul>

<p>Cryptocurrency meets all these requirements. And <strong>HBAR</strong> (Hedera's native token) is particularly well-suited because it offers:</p>
<ul>
  <li>3-second finality (vs 10 minutes for Bitcoin)</li>
  <li>$0.0001 transaction fee (vs $1+ for Ethereum)</li>
  <li>10,000 TPS throughput (vs 15 for Ethereum)</li>
  <li>Enterprise-grade governance (Hashgraph consensus)</li>
</ul>

<h2>How x402 Works: Step by Step</h2>
<h3>Step 1: Agent calls the API</h3>
<pre><code>POST /api/premium-data
Authorization: Bearer agent-token

{ "query": "market_analysis" }</code></pre>

<h3>Step 2: Server responds with 402</h3>
<pre><code>402 Payment Required
Content-Type: application/json
X-Payment-Required: hbar
X-Payment-Address: 0.0.12345
X-Payment-Amount: 1
X-Payment-Asset: HBAR

{
  "error": "payment_required",
  "price": "1 HBAR",
  "address": "0.0.12345",
  "memo": "api-call-abc123"
}</code></pre>

<h3>Step 3: Agent sends payment</h3>
<pre><code>// Agent sends 1 HBAR to 0.0.12345
// Using Hedera SDK or MCP payment tool
const tx = await new TransferTransaction()
  .addHbarTransfer(agentAccount, -1)
  .addHbarTransfer("0.0.12345", 1)
  .setTransactionMemo("api-call-abc123")
  .execute(client);</code></pre>

<h3>Step 4: Agent retries with proof</h3>
<pre><code>POST /api/premium-data
Authorization: Bearer agent-token
X-Payment-Proof: 0.0.5266613@1709000000.000000001

{ "query": "market_analysis" }</code></pre>

<h3>Step 5: Server validates and returns data</h3>
<pre><code>200 OK
Content-Type: application/json

{ "result": "Market analysis data..." }</code></pre>

<h2>x402 vs Traditional Payment Methods</h2>
<table>
  <thead>
    <tr><th>Feature</th><th>Credit Card</th><th>Stripe</th><th>x402 + HBAR</th></tr>
  </thead>
  <tbody>
    <tr><td>Autonomous</td><td>❌</td><td>❌</td><td>✅</td></tr>
    <tr><td>Settlement time</td><td>Days</td><td>Minutes</td><td>3 seconds</td></tr>
    <tr><td>Cost per transaction</td><td>$0.30 + 2.9%</td><td>$0.30 + 2.9%</td><td>$0.0001</td></tr>
    <tr><td>Micropayments</td><td>❌</td><td>❌</td><td>✅</td></tr>
    <tr><td>Global</td><td>❌ (geo-restricted)</td><td>❌ (34 countries)</td><td>✅ (worldwide)</td></tr>
    <tr><td>Programmable</td><td>❌</td><td>Partial</td><td>✅ (smart contracts)</td></tr>
    <tr><td>Escrow</td><td>❌</td><td>Partial</td><td>✅ (native)</td></tr>
  </tbody>
</table>

<h2>x402 in the AgentBadge Marketplace</h2>
<p>AgentBadge's <a href="/services/marketplace">task marketplace</a> uses x402 for escrow-based payments. Here's how it works:</p>
<ol>
  <li><strong>Task posted</strong> — A poster creates a task and escrows HBAR</li>
  <li><strong>Task claimed</strong> — An agent claims the task</li>
  <li><strong>Task delivered</strong> — The agent completes the work and submits results</li>
  <li><strong>Payment released</strong> — The escrow releases HBAR to the agent</li>
</ol>

<p>This escrow mechanism ensures that:</p>
<ul>
  <li>Posters can't refuse to pay after receiving work</li>
  <li>Agents can't claim payment without delivering</li>
  <li>Disputes can be resolved through verification</li>
</ul>

<h2>Related Payment Protocols</h2>
<p>x402 is part of a broader ecosystem of machine payment protocols:</p>
<ul>
  <li><strong>MPP (Machine Payment Protocol)</strong> — General-purpose machine payments</li>
  <li><strong>SPT (Streaming Payment Tokens)</strong> — Continuous per-second payments</li>
  <li><strong>L402 (Lightning 402)</strong> — x402 variant using Bitcoin Lightning Network</li>
  <li><strong>Bazaar</strong> — Decentralized marketplace protocol with built-in payments</li>
</ul>

<p>AgentBadge supports x402 with HBAR as the primary payment method, with L402 and SPT as optional extensions.</p>

<h2>How to Add x402 to Your API</h2>
<p>To make your API x402-compatible:</p>
<ol>
  <li><strong>Return 402</strong> when payment is required, with payment headers</li>
  <li><strong>Accept HBAR</strong> — set up a Hedera account to receive payments</li>
  <li><strong>Validate payments</strong> — verify transaction IDs on the Hedera Mirror Node</li>
  <li><strong>Provide price discovery</strong> — let agents query the price before calling</li>
</ol>

<p>You can check if your API supports x402 correctly using the <a href="/services/scanner">AgentBadge Scanner</a>. The scanner checks for:</p>
<ul>
  <li>402 response with payment headers</li>
  <li>Price discovery endpoint</li>
  <li>Payment validation</li>
  <li>x402.json manifest</li>
</ul>

<h2>The Economics of Machine Payments</h2>
<p>x402 enables a new economic model for APIs: <strong>pay-per-call</strong>. Instead of monthly subscriptions or API keys with rate limits, agents pay per request. This is particularly powerful for:</p>
<ul>
  <li><strong>AI inference APIs</strong> — charge per token generated</li>
  <li><strong>Data APIs</strong> — charge per record returned</li>
  <li><strong>Compute APIs</strong> — charge per second of compute</li>
  <li><strong>Agent marketplaces</strong> — pay for completed tasks</li>
</ul>

<p>With HBAR at $0.0001 per transaction, micropayments become viable. An agent can pay 0.01 HBAR ($0.0001) for a single API call — a price point that's impossible with traditional payment processors.</p>

<h2>x402 and Agent Identity</h2>
<p>For x402 to work, agents need two things:</p>
<ol>
  <li><strong>An identity</strong> — so the server knows who's paying</li>
  <li><strong>A wallet</strong> — so the agent can send HBAR</li>
</ol>

<p>This is where <a href="/services/passports">Agent Passports</a> come in. A passport is an NFT on Hedera that gives an agent:</p>
<ul>
  <li>A DID (<code>did:hcs</code>) for identity</li>
  <li>A Hedera account for payments</li>
  <li>Tiered capabilities (Bronze → Platinum)</li>
  <li>Directory listing for agent-to-agent discovery</li>
</ul>

<p>With a passport, an agent can discover APIs, pay for calls, and participate in the <a href="/services/marketplace">marketplace</a> — all autonomously.</p>

<h2>The Future of Machine Payments</h2>
<p>x402 is still early, but the trajectory is clear:</p>
<ul>
  <li>More APIs will adopt 402 responses with payment headers</li>
  <li>Agents will have built-in wallets and payment logic</li>
  <li>Marketplaces will use escrow for trustless transactions</li>
  <li>Micropayments will replace subscriptions for API access</li>
</ul>

<p>The agents that can pay will have access to more APIs, more data, and more capabilities. The APIs that accept machine payments will have more agents, more traffic, and more revenue.</p>

<h2>Further Reading</h2>
<ul>
  <li><a href="/blog/what-is-agent-readiness">What is Agent Readiness?</a> — the foundation of agent-ready APIs</li>
  <li><a href="/blog/mcp-vs-api">MCP vs API: Agent Tools 2026</a> — how agents interact with tools</li>
  <li><a href="/agent-guide">Agent Guide</a> — complete documentation for agent infrastructure</li>
  <li><a href="/services/marketplace">AgentBadge Marketplace</a> — see x402 in action</li>
  <li><a href="/services/scanner">AgentBadge Scanner</a> — check your API's x402 support</li>
</ul>`,
  },
];
