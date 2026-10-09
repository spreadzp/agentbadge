import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c14-agent-discovery",
  title: "An Agent Lands on Your Homepage — What Can It Actually Read?",
  description:
    "Eleven machine-readable manifests under /.well-known plus a generated llms.txt — the full AgentBadge discovery surface is built from live sources (openapi, route config, SKU catalog), never hand-edited, CI-gated on drift, and dogfooded by our own 142-rule readiness scanner.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-09",
  dateModified: "2026-10-09",
  tags: ["agents", "discovery", "a2a", "mcp", "x402", "arc", "web3", "ai-agents"],
  readingTime: "6 min",
  shortAnswer:
    "An AI agent that lands on agentbadge.xyz now finds eleven live .well-known manifests (agent-card, api-catalog, ERC-8004, MCP server card, evaluation ladder, DID/JWKS, security.txt) plus a generated llms.txt — all projected from live code sources, CI-checked for drift, and verified by our own scanner at 100% pass.",
  agentGuideSlug: "arc-c14-agent-discovery",
  heroImage: "/images/blog/arc-c14-agent-discovery-hero.png",
  ogImage: "/images/blog/arc-c14-agent-discovery-og.png",
  content: `<p>An AI agent evaluating a vendor does what a human does: it opens the site and looks for proof. The difference is speed and format — the agent gives you seconds, not minutes, and it wants JSON, not hero banners. Until recently, an agent landing on agentbadge.xyz found a page built for humans and nothing else — while our own readiness scanner was out there grading <em>other</em> sites on exactly the signals we lacked. The cobbler had no shoes. This week we fixed that: the entire discovery surface is now <strong>generated from live sources</strong>, served free with no auth, and verified by our own scanner in CI.</p>
<p>This is article C14 in the Arc Campaign series. It sits directly under <a href="https://agentbadge.xyz/blog/arc-c15-x402-bazaar">C15</a> — C14 is how an agent <em>finds</em> us; C15 is what it reads once it wants to <em>buy</em>.</p>
<p><img src="/images/blog/arc-c14-agent-discovery-hero.png" alt="An agent arriving at a site that opens into a machine-readable JSON interior" /></p>
<h2 id="manifests">What does an agent find in 200 milliseconds?</h2>
<p>Eleven machine-readable manifests, all <code>200 OK</code>, all free, all generated — not hand-maintained:</p>
<pre><code class="language-text">/.well-known/agent-card.json        A2A v1.0 — who we are, skills[]
/.well-known/api-catalog            RFC 9727 linkset — every API entry
/.well-known/erc8004-agent.json     on-chain identity registration
/.well-known/mcp/server-card.json   MCP capabilities + tools surface
/.well-known/agent-evaluation.json  verification ladder (claims→refs)
/.well-known/owner-questions.json   "who runs this" for due-diligence
/.well-known/did.json               did:web:agentbadge.xyz document
/.well-known/did-configuration.json signed domain linkage (VC-JWT)
/.well-known/jwks.json              real Ed25519 key, kid'd
/.well-known/security.txt           RFC 9116, Expires generated +1y
/llms.txt                           agent-oriented sitemap</code></pre>
<p>The agent-card alone answers the A2A handshake: name, provider, <code>supportedInterfaces[]</code>, <code>skills[]</code> with tags and examples, and <code>securitySchemes</code> declaring <code>x402</code> as the payment rail. One GET and a foreign agent knows our identity, capabilities, and how to pay.</p>
<p><img src="/images/blog/arc-c14-agent-discovery-1.webp" alt="A glowing .well-known directory tree of eleven manifests, each marked 200 OK" /></p>
<h2 id="generation">Where do the manifests come from?</h2>
<p>Not from a copywriter — from the code itself. A manifest registry collects the same live sources the runtime uses — <code>openapi.ts</code>, route config, <code>blog-data.ts</code>, the SKU catalog — and every manifest is a <strong>projection</strong> of that truth:</p>
<ul>
<li><strong>Boot-time</strong>: env-dependent manifests (URLs, keys, DID document) are generated into a manifest registry when the server starts — routes serve from it, so there is exactly one source.</li>
<li><strong>Build-time</strong>: <code>bun run gen:discovery</code> writes snapshots under <code>public/.well-known/</code> — manual edits are banned.</li>
<li><strong>CI drift-check</strong>: regenerate and <code>git diff --exit-code</code> — if a manifest drifted from the code that produced it, the build fails. Env-dependent files get golden tests with mocked env instead.</li>
</ul>
<p>This is the difference between us and a hand-maintained <code>.well-known</code> directory: ours <em>cannot go stale</em> without the build telling us.</p>
<p><img src="/images/blog/arc-c14-agent-discovery-d1.webp" alt="Pipeline diagram: live sources → manifest registry → .well-known manifests → consumers, with a CI drift check" /></p>
<h2 id="llms-txt">What does a machine-readable sitemap look like?</h2>
<p><code>llms.txt</code> — the de-facto convention for telling an LLM "start here": H1 title, a blockquote describing the platform, then <code>##</code> sections of named links. Ours is generated with sections for machine-readable entry points, quick start, free and paid endpoints:</p>
<pre><code class="language-markdown"># AgentBadge

&gt; Agent identity, discovery, and x402 micropayments on Arc.

## Machine-readable Entry Points
- [Agent Card JSON](/.well-known/agent-card.json) — capabilities
- [OpenAPI 3.1 Spec](/api/specs) — full API spec
- [MCP Server](/mcp) — JSON-RPC over HTTP
- [Service Catalog](/api/v1/services) — SKUs, prices, input schemas</code></pre>
<p>A crawler following this file reaches every paid surface with its price and input schema — the <code>llms.txt</code> <em>services</em> section anchors into the same <code>/api/v1/services</code> catalog that powers the bazaar extension from <a href="https://agentbadge.xyz/blog/arc-c15-x402-bazaar">C15</a>.</p>
<p><img src="/images/blog/arc-c14-agent-discovery-2.webp" alt="Generation pipeline from live sources through the manifest registry to the .well-known outputs, guarded by a CI shield" /></p>
<h2 id="markdown-negotiation">Why serve the same page twice?</h2>
<p>Because the reader might not be a browser. <code>Accept: text/markdown</code> on any page gets the markdown representation instead of HTML — verified live:</p>
<pre><code class="language-bash">$ curl -sH "Accept: text/markdown" https://agentbadge.xyz/blog
content-type: text/markdown; charset=utf-8</code></pre>
<p>Blog articles additionally carry <code>.md</code> mirrors — <code>/blog/arc-c10-payer-binding.md</code> returns <code>200 text/markdown</code>. The HTML page stays canonical; <code>&lt;link rel="alternate" type="text/markdown"&gt;</code> points machines at the twin. One URL, two readers, zero content duplication.</p>
<p><img src="/images/blog/arc-c14-agent-discovery-3.webp" alt="One URL split into two representations — HTML page for a human reader, markdown document for an agent" /></p>
<h2 id="evaluation-ladder">Can an agent verify our claims without trusting us?</h2>
<p>That is the point of <code>agent-evaluation.json</code> — a <strong>verification ladder</strong>: claims ordered by how long they take to check, each with an explicit <code>action</code> and <code>ref</code>:</p>
<pre><code class="language-json">{
  "depth": "5s",
  "checks": [
    { "claim": "mainnet deployment — AgentEventLog on Arc",
      "action": "open",
      "ref": "https://explorer.arc.io/address/0x1bb6…4700" },
    { "claim": "agent card published (A2A v1.0)",
      "action": "GET",
      "ref": "https://agentbadge.xyz/.well-known/agent-card.json" }
  ]
}</code></pre>
<p>At 5 seconds an agent confirms we exist on-chain and publish a card. At 60 seconds it checks manifest validity, the live OpenAPI spec, and the refusal contract. Deeper rungs point at dogfood transactions and audit trails. <code>owner-questions.json</code> answers the due-diligence questions an enterprise agent would ask — operator, jurisdiction, contact — in the same machine-readable shape.</p>
<p><img src="/images/blog/arc-c14-agent-discovery-4.webp" alt="A verification ladder of three glowing steps labeled 5s, 60s, 5min, climbed by an agent" /></p>
<h2 id="dogfood">How do we know it works?</h2>
<p>We run our own scanner on ourselves — the same 142-rule engine that grades other sites' agent-readiness. The rules it checks on foreign domains — <code>/.well-known/mcp/server-card.json</code> (AB-006), <code>llms.txt</code> (AB-014), JSON-LD/OG metadata (AB-015/016), <code>ai.txt</code> (AB-017) — now run against agentbadge.xyz in CI as a dogfood gate: <strong>100% pass required</strong>. If a deploy breaks a manifest, our own product flags our own site.</p>
<p><img src="/images/blog/arc-c14-agent-discovery-d2.webp" alt="Agent journey diagram: land on site → llms.txt → agent-card → api-catalog → evaluation ladder → free endpoint → 402 payment → paid response" /></p>
<h2 id="status">Honest status</h2>
<ul>
<li><strong>Live now</strong>: all 11 manifests <code>200 OK</code> on agentbadge.xyz; markdown negotiation serving <code>text/markdown</code>; <code>.md</code> mirrors on blog articles; generated, not hand-edited.</li>
<li><strong>Deliberately absent</strong>: <code>ai-plugin.json</code> — OpenAI killed ChatGPT Plugins in 2024; publishing a dead manifest is cargo cult, not compliance. <code>/.well-known/agent.json</code> returns <code>301</code> to <code>agent-card.json</code> instead of rotting as a stale v0.x file.</li>
<li><strong>Identity</strong>: <code>did:web:agentbadge.xyz</code> resolves (see <a href="https://agentbadge.xyz/blog/arc-c27-did-web-identity">C27</a>); Arc-era identities stay as ERC-8004 <code>eip155:</code> refs, not DIDs.</li>
<li><strong>To verify right now</strong>: <code>curl https://agentbadge.xyz/.well-known/agent-card.json</code> — or point our scanner at us: <code>npx agentbadge-scan agentbadge.xyz</code>.</li>
</ul>
<p><em>C14 in the Arc Campaign series. <a href="https://agentbadge.xyz/blog/arc-c15-x402-bazaar">C15</a> continues the journey — the agent found us, now it reads the price list. Earlier: <a href="https://agentbadge.xyz/blog/arc-c27-did-web-identity">C27</a> made the domain itself the identity.</em></p>`,
};
