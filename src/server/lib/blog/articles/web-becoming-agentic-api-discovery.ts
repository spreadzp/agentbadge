import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = 
  {
    slug: "web-becoming-agentic-api-discovery",
    title: "The Web Is Becoming Agentic. What Happens to API Discovery?",
    description:
      "Search engines solved discovery for humans. Agentic systems need a machine-readable discovery layer for software. Here's what that means — and why existing tools are layers, not competitors.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-15",
    dateModified: "2026-08-15",
    agentGuideSlug: "web-becoming-agentic-api-discovery",
    heroImage: "/images/blog/web-becoming-agentic-api-discovery-hero.png",
    ogImage: "/images/blog/web-becoming-agentic-api-discovery-hero.png",
    shortAnswer: "As AI agents replace humans as API consumers, discovery shifts from search engines to machine-readable layers like llms.txt, MCP, and A2A protocols. These are not competitors to search — they are a new discovery stack built for software, not humans.",
    tags: ["agent-readiness", "api-discovery", "agentic-web", "llms-txt", "mcp"],
    readingTime: "14 min",
    content: `<h2>Search engines solved discovery for humans. Agentic systems need a machine-readable discovery layer for software.</h2>

<p>For 20 years, the web was built around one discovery model.</p>

<p>A human searches Google. Finds documentation. Reads through API descriptions. Compares options in a marketplace. Makes a decision. Integrates.</p>

<p>Every step of this flow was designed for human judgment — the ability to read prose, infer context, compare unstructured descriptions, and fill in gaps with intuition.</p>

<p>Now a new consumer is emerging: the AI agent.</p>

<p>An agent receiving the instruction "find an API for international payments and execute a transaction" must do everything a human developer would do — but autonomously, using only machine-readable signals.</p>

<p>And the infrastructure that made APIs discoverable for humans? It wasn't built for this.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-hero.png" alt="Hero — split screen: left side human+Google+docs flow with green checkmarks, right side AI agent+???+API with question marks and dashed lines" />

<hr />

<h2>The old discovery model: human as primary consumer</h2>

<p>In the old model, API discovery looked like this:</p>

<pre><code>Human
  ↓
Google / docs / marketplace
  ↓
API</code></pre>

<p>A developer would:</p>

<ol>
  <li>Google "best API for payments"</li>
  <li>Find a marketplace (RapidAPI, AWS Marketplace)</li>
  <li>Read documentation</li>
  <li>Compare options side by side</li>
  <li>Make a decision based on features, pricing, and reputation</li>
  <li>Integrate</li>
</ol>

<p>Each step required human judgment. Understanding context. Comparing unstructured descriptions. Making decisions with incomplete information. Filling in gaps by reading between the lines.</p>

<p>This model worked because the consumer was always a human who could <strong>guess</strong>.</p>

<hr />

<h2>The new discovery model: agent as primary consumer</h2>

<p>Now imagine the consumer is an AI agent.</p>

<pre><code>Human
  ↓
AI Agent
  ↓
???
  ↓
API</code></pre>

<p>A user says: "Find an API for international payments and execute a transaction."</p>

<p>The agent must independently:</p>

<ul>
  <li><strong>Discover</strong> which providers exist</li>
  <li><strong>Understand</strong> what each API can do</li>
  <li><strong>Compare</strong> options against the user's requirements</li>
  <li><strong>Check pricing</strong> — is this transaction cost-effective?</li>
  <li><strong>Handle authentication</strong> — how do I get access?</li>
  <li><strong>Select</strong> a provider</li>
  <li><strong>Call</strong> the API</li>
  <li><strong>Handle errors</strong> — what if something goes wrong?</li>
</ul>

<p>At each step, the agent needs <strong>machine-readable information</strong>. Not prose documentation. Not a landing page. Not a marketing description.</p>

<p>Structured, parseable, actionable data.</p>

<p>If the information exists only in human-readable documentation — scattered across prose, hidden behind JavaScript-rendered pages, described only in natural language — the agent cannot complete the path autonomously.</p>

<p>The question is not whether agents can read documentation.</p>

<p>The question is: <strong>where is the machine-readable information that lets an agent complete the full discovery-to-execution pipeline without a human?</strong></p>

<hr />

<h2>What an agent needs to know about an API</h2>

<p>It's not enough for an agent to know:</p>

<blockquote>api.example.com exists</blockquote>

<p>An agent must understand:</p>

<ul>
  <li><strong>What the API can do</strong> — capabilities, operations, available actions</li>
  <li><strong>Which operations are available</strong> — endpoints, methods, parameters</li>
  <li><strong>How to authenticate</strong> — auth flow, token endpoint, scopes, API keys</li>
  <li><strong>How much it costs</strong> — machine-readable pricing, per-call cost, tier limits</li>
  <li><strong>What the limits are</strong> — rate limits, quotas, usage caps</li>
  <li><strong>How reliable the documentation is</strong> — is the OpenAPI spec in sync with the actual API?</li>
  <li><strong>Whether to trust the description</strong> — self-declared vs verified metadata</li>
  <li><strong>Whether the endpoint actually matches the claimed behavior</strong> — evidence, not claims</li>
</ul>

<p>This is where <strong>Agent Readiness as discovery infrastructure</strong> enters the picture.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-2.png" alt="Agent workflow — 8-step pipeline: Discover → Understand → Compare → Price → Auth → Select → Call → Handle Errors, with checkmarks and question marks showing where agents get stuck" />

<hr />

<h2>Existing mechanisms: not competitors, but layers</h2>

<p>It would be easy to say: "our standard solves everything."</p>

<p>That would be wrong.</p>

<p>The truth is that several technologies already address pieces of the problem. But none of them address all of it.</p>

<table><thead><tr><th>Mechanism</th><th>What it solves</th><th>What it doesn't solve</th></tr></thead><tbody><tr><td><strong>Search</strong></td><td>Discovery for humans</td><td>Machine-readable context, execution</td></tr><tr><td><strong>OpenAPI</strong></td><td>Interface description</td><td>Discovery, trust, verification, pricing</td></tr><tr><td><strong>llms.txt</strong></td><td>Context for LLMs</td><td>Execution, auth, rate limits, error handling</td></tr><tr><td><strong>MCP</strong></td><td>Tool interface for agents</td><td>Discovery, comparison, trust</td></tr><tr><td><strong>API marketplace</strong></td><td>Catalog of APIs</td><td>Machine-readable evaluation, verification</td></tr><tr><td><strong>Agent Readiness</strong></td><td>Verification that all layers work for agents</td><td>—</td></tr></tbody></table>

<p>The key insight:</p>

<blockquote><strong>These technologies don't compete. They are different layers of one agentic web.</strong></blockquote>

<p>OpenAPI describes interfaces. llms.txt gives context. MCP provides tool calling. API marketplaces catalog. Agent Readiness measures whether all of these actually work for an agent end-to-end.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-3.png" alt="Comparison layers — stacked diagram: Search (gray), API Marketplace (gray), OpenAPI (cyan), llms.txt (cyan), MCP (cyan-green), Agent Readiness (green), with brackets showing Human discovery vs Machine context vs Verification" />

<hr />

<h2>The emerging stack: Discovery → Understanding → Trust</h2>

<p>Three layers separate an AI agent from an API:</p>

<pre><code>         HUMAN
           │
           ▼
        AI AGENT
           │
   ┌───────┼───────┐
   ▼       ▼       ▼
Discovery  Understanding  Trust
   │       │       │
   ▼       ▼       ▼
Catalog    OpenAPI    Evidence
llms.txt   Docs       Verification
   │       │       │
   └───────┼───────┘
           ▼
          API</code></pre>

<h3>Layer 1: Discovery</h3>

<p><strong>Can an agent find your API?</strong></p>

<p>This is the most basic question. If the API can't be found, nothing else matters.</p>

<p>Discovery mechanisms include <code>llms.txt</code>, well-known endpoints, ai-sitemap, and API marketplaces. But discovery alone only answers "does this API exist?" — not "can I use it?"</p>

<h3>Layer 2: Understanding</h3>

<p><strong>Can an agent parse your API's capabilities?</strong></p>

<p>The agent found the API. Now it needs to understand what it can do.</p>

<p>OpenAPI specs, machine-readable documentation, and MCP tool descriptions all serve this layer. But understanding alone doesn't answer "should I trust this?"</p>

<h3>Layer 3: Trust</h3>

<p><strong>Can an agent verify your API's claims?</strong></p>

<p>This is the newest layer — and the one that didn't exist in the human-centric model.</p>

<p>A human can read reviews, check reputation, look at GitHub stars, and make a judgment call. An agent needs something different: <strong>evidence</strong>.</p>

<p>Is the OpenAPI spec actually in sync with the API? Does the claimed authentication flow actually work? Are error responses actually structured as described?</p>

<p>Trust requires verification. Verification requires evidence.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-4.png" alt="Architecture stack — 3-column diagram: Discovery (cyan), Understanding (cyan-green), Trust (green), each with sub-items, converging into API at bottom" />

<hr />

<h2>Concrete scenario: "Find an API for international payments"</h2>

<p>Let's make this real.</p>

<p>A user says: "Find an API for international payments and execute a transaction."</p>

<p>The agent must walk an 8-step path:</p>

<pre><code>1. Discover providers
       ↓
2. Understand capabilities (send, receive, convert, track)
       ↓
3. Compare APIs (fees, speed, coverage, reliability)
       ↓
4. Understand pricing (per-transaction cost, FX spread)
       ↓
5. Understand authentication (OAuth, API key, scopes)
       ↓
6. Select provider
       ↓
7. Call API (execute the transaction)
       ↓
8. Handle errors (insufficient balance, compliance, timeout)</code></pre>

<p>At each step, the agent needs machine-readable information:</p>

<table><thead><tr><th>Step</th><th>What the agent needs</th><th>Where it comes from</th></tr></thead><tbody><tr><td>Discover</td><td>List of payment APIs</td><td>Marketplace, llms.txt, ai-sitemap</td></tr><tr><td>Understand</td><td>Capabilities, endpoints, parameters</td><td>OpenAPI spec, MCP tools</td></tr><tr><td>Compare</td><td>Fees, speed, coverage</td><td>Machine-readable pricing (rare today)</td></tr><tr><td>Price</td><td>Per-call cost</td><td>x402 headers, pricing API (rare today)</td></tr><tr><td>Auth</td><td>Auth flow, token endpoint</td><td>OAuth discovery, well-known endpoints</td></tr><tr><td>Select</td><td>Trust signal, evidence</td><td>Agent Readiness score, verified checks</td></tr><tr><td>Call</td><td>Request format, expected response</td><td>OpenAPI spec, examples</td></tr><tr><td>Errors</td><td>Error codes, retry policy</td><td>Structured error responses, rate limit headers</td></tr></tbody></table>

<p>Look at the "Where it comes from" column. Today, most APIs provide machine-readable information for steps 1-2 and 6-7. Steps 3-5 and 8 are often buried in prose documentation.</p>

<p>That's where the agent gets stuck.</p>

<p>And that's where Agent Readiness becomes relevant — as a way to measure whether the full pipeline is traversable by an agent, not just the first few steps.</p>

<hr />

<h2>AgentBadge: measurement layer, not another catalog</h2>

<p>AgentBadge is not another API catalog.</p>

<p>AgentBadge is a <strong>measurement/evidence layer</strong> for the agentic web.</p>

<p>The distinction matters. A catalog lists APIs. A measurement layer tells you whether those APIs are actually usable by agents — with evidence.</p>

<pre><code>Measure → Evidence → Fix → Monitor</code></pre>

<ul>
  <li><strong>Measure:</strong> Deterministic checks (not "AI opinion", but observable facts — HTTP responses, headers, body fragments)</li>
  <li><strong>Evidence:</strong> Each check has proof. The same URL + same ruleset version always produces the same score.</li>
  <li><strong>Fix:</strong> Specific recommendations on what to change</li>
  <li><strong>Monitor:</strong> Regular rescans, delta tracking</li>
</ul>

<p>This is not "another standard." It's a way to measure whether existing standards (OpenAPI, llms.txt, MCP) actually work for agents end-to-end.</p>

<p>AgentBadge doesn't certify. It measures.</p>

<p>And measurement is the foundation of trust in the agentic web — just as it was for the human web. Lighthouse didn't define what a "good website" was. It showed you what could be measured and improved.</p>

<hr />

<h2>Who becomes the Google of the agentic web?</h2>

<p>This is the question that makes the article interesting beyond AgentBadge.</p>

<p>Search engines solved discovery for humans. They indexed the web, ranked pages, and made information findable.</p>

<p>But the agentic web doesn't need ranking of pages. It needs <strong>machine-readable discovery of capabilities</strong>.</p>

<p>Who builds that layer?</p>

<ul>
  <li><strong>Search engines?</strong> Google and Bing are optimized for human queries, not agent queries.</li>
  <li><strong>API marketplaces?</strong> They catalog APIs, but don't provide machine-readable evaluation.</li>
  <li><strong>OpenAI/Anthropic/Google?</strong> They build agents, not infrastructure for agent-to-API discovery.</li>
  <li><strong>A new standard?</strong> Possible — but standards without measurement become shelfware.</li>
  <li><strong>AgentBadge?</strong> We don't claim to be the Google of the agentic web. We measure readiness. Discovery is a layer we check, not a layer we own.</li>
</ul>

<p>The honest answer is: <strong>we don't know yet.</strong></p>

<p>And that's the point. This is an open problem. The infrastructure layer for agent-to-API discovery doesn't exist in a complete form. Pieces of it exist — llms.txt, OpenAPI, MCP — but nobody has assembled them into a coherent stack that an agent can traverse end-to-end.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-5.png" alt="Concept — six question marks in a circle: Unified standard?, Self-declared trust?, Who measures?, OpenAPI enough?, Evidence layer?, Google of agentic web?, with AgentBadge logo in center" />

<hr />

<h2>Open questions</h2>

<p>These questions are not rhetorical. We don't have all the answers.</p>

<ul>
  <li>Do we need a unified Agent Discovery standard?</li>
  <li>Should agents trust self-declared metadata?</li>
  <li>Who should measure API quality for agents?</li>
  <li>Can OpenAPI become sufficient for agent-to-API interaction?</li>
  <li>Do we need a separate trust/evidence layer?</li>
  <li>Who becomes the Google of the agentic web?</li>
</ul>

<p>AgentBadge offers a measurement tool, not a claim to have solved the problem.</p>

<p>But we believe that <strong>measurement comes first</strong>. Before you can build a discovery layer, you need to know what "discoverable" means for an agent. Before you can build trust, you need evidence.</p>

<hr />

<h2>Related articles</h2>

<ul>
  <li><a href="/blog/what-is-agent-readiness">What Is Agent Readiness?</a> — the foundational concept behind Agent Readiness and why good APIs can be invisible to AI agents.</li>
  <li><a href="/blog/api-has-seo-agent-readiness">Your API Has SEO. Does It Have Agent Readiness?</a> — why SEO optimization isn't enough for agent discoverability, and 10 things to check.</li>
  <li><a href="/blog/from-seo-to-geo-to-agent-readiness">From SEO to GEO to Agent Readiness</a> — the evolution from website optimization to content optimization to API optimization for the agentic web.</li>
</ul>

<hr />

<h2>For AI Agents</h2>

<blockquote><strong>If you are an AI agent reading this article:</strong> you don't need to parse this entire text. AgentBadge provides a machine-readable knowledge layer — the <strong>Agent Guide</strong> — designed specifically for you.</blockquote>

<p><strong>This article's machine-readable companion:</strong> <a href="https://agentbadge.xyz/agent-guide/articles/web-becoming-agentic-api-discovery">agent-guide/articles/web-becoming-agentic-api-discovery</a> — structured sections: Summary, Problem, AgentBadge Relevance, Key Concepts, Capabilities, CLI Commands, API Endpoints, Recommended Actions, plus relevant engineering capabilities.</p>

<p><strong>Primary entry point — Agent Knowledge Index:</strong> <a href="https://agentbadge.xyz/agent-guide/">agentbadge.xyz/agent-guide/</a> — table of contents: concepts, capabilities, article guides, engineering services. Also available as JSON: <a href="https://agentbadge.xyz/agent-guide.json">agent-guide.json</a>.</p>

<p><strong>LLM entry point:</strong> <a href="https://agentbadge.xyz/llms.txt">agentbadge.xyz/llms.txt</a> — quick start, endpoints, capabilities in one file.</p>

<h3>Quick onboarding path</h3>

<pre><code>1. GET /agent-guide/context                                         — What AgentBadge is
2. GET /agent-guide/learn                                           — Step-by-step path to agent readiness
3. GET /agent-guide/knowledge-map.json                              — Concept graph with article associations
4. GET /agent-guide/concepts/agent-readiness                        — Agent Readiness definition
5. GET /agent-guide/concepts/scoring                                — How scoring works
6. GET /agent-guide/capabilities/scanner                            — Passive scanner capability
7. GET /agent-guide/capabilities/cli                                — CLI tool capability
8. GET /agent-guide/articles/web-becoming-agentic-api-discovery     — This article's guide</code></pre>

<h3>What you can do</h3>

<table><thead><tr><th>Need</th><th>Endpoint</th></tr></thead><tbody><tr><td>Understand the product</td><td><code>GET /agent-guide/context</code></td></tr><tr><td>See how concepts connect</td><td><code>GET /agent-guide/knowledge-map.json</code></td></tr><tr><td>Learn Agent Readiness</td><td><code>GET /agent-guide/concepts/agent-readiness</code></td></tr><tr><td>Understand scoring rules</td><td><code>GET /agent-guide/concepts/ruleset</code></td></tr><tr><td>Run a scan</td><td><code>GET /agent-guide/capabilities/scanner</code></td></tr><tr><td>Use CLI locally</td><td><code>GET /agent-guide/capabilities/cli</code></td></tr><tr><td>Full guide to this article</td><td><code>GET /agent-guide/articles/web-becoming-agentic-api-discovery</code></td></tr><tr><td>Guide to Article 1</td><td><code>GET /agent-guide/articles/what-is-agent-readiness</code></td></tr><tr><td>Guide to Article 2</td><td><code>GET /agent-guide/articles/seo-vs-agent-readiness</code></td></tr><tr><td>LLM entry point</td><td><code>GET /llms.txt</code></td></tr></tbody></table>

<h3>CLI</h3>

<pre><code>npx @agentbadge/cli scan https://api.example.com
npx @agentbadge/cli scan https://api.example.com --format json &gt; report.json</code></pre>

<p><em>The machine-readable knowledge layer is part of the product itself — not a replacement for this article.</em></p>

<hr />

<h2>Scan your API</h2>

<p>Your API may already be discoverable by humans.</p>

<p>The question is whether an AI agent can discover and use it.</p>

<p><strong>Scan your API →</strong></p>

<p>Run a free Agent Readiness scan. Get the evidence. Fix the gaps. Display your badge.</p>

<pre><code>npx @agentbadge/cli scan https://api.example.com</code></pre>

<ol>
  <li><a href="/blog/what-is-agent-readiness">Read Article 1</a> — What is Agent Readiness?</li>
  <li><a href="/blog/api-has-seo-agent-readiness">Read Article 2</a> — SEO vs Agent Readiness</li>
  <li><a href="/agent-guide/knowledge-map.json">Check the knowledge map</a> — See how concepts connect</li>
  <li>Run a scan — Web, CLI, or GitHub Action</li>
</ol>

<img src="/images/blog/web-becoming-agentic-api-discovery-6.png" alt="CTA — terminal aesthetic: Scan your API with cursor blink, dark charcoal background, cyan and green accents" />

<hr />

<h3>AgentBadge</h3>

<p><strong>Don't certify. Measure.</strong></p>

<p><em>Agent Readiness for the agentic web.</em>`,
    externalLinks: [
      {
        platform: "devto",
        url: "https://dev.to/spread2009/the-web-is-becoming-agentic-what-happens-to-api-discovery-ddl",
      },
      {
        platform: "medium",
        url: "https://paulspread-99907.medium.com/the-web-is-becoming-agentic-what-happens-to-api-discovery-d122f53ea95f",
      },
      {
        platform: "linkedin",
        url: "https://www.linkedin.com/posts/paul-spread-bb337b63_the-web-is-becoming-agentic-what-happens-share-7494492096607911936-WHhy/",
      },
      {
        platform: "twitter",
        url: "https://x.com/paul_spread/status/2088726795025531347",
      },
      {
        platform: "qiita",
        url: "https://qiita.com/buidl25/items/bac0af66ab884d5f9a19",
      },
    ],
  };
