/**
 * EPIC-256 · C54 — WebMCP v2 site tools: page-scoped browser tools for AI
 * agents on production (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c54-webmcp-site-tools/AgentBadge-Blog.md
 */
export const arcC54WebmcpSiteToolsContent = `
<h2>Why does a website need tools for agents at all?</h2>

<p><em>Agents don't need another API key - they need a menu on the page.</em></p>

<p>For a junior: today an AI agent that wants to use your website has two bad options - scrape the HTML and guess, or go read your REST API documentation and wire a client. WebMCP is a third option: the page itself registers JavaScript functions - name, description, JSON schema - into <code>document.modelContext</code>, and any WebMCP-aware agent can list them and call them with structured arguments. No key, no SDK, no parsing.</p>

<p>Three things converged in November 2026 that made us ship this now:</p>

<ul>
<li><strong>OpenAI documented Site tools</strong> - their implementation of the WebMCP proposal. The built-in browser in the ChatGPT desktop app discovers site tools and uses them while you watch the same page. (<code>learn.chatgpt.com/docs/webmcp</code>)</li>
<li><strong>Chrome runs an Origin Trial</strong> - <code>document.modelContext</code> lives behind <code>--enable-features=WebMCP</code> on Chrome 146+; we tested on Chrome 153.</li>
<li><strong>The W3C community spec</strong> (<code>webmachinelearning.github.io/webmcp</code>) defines the contract: <code>registerTool</code>, <code>getTools</code>, <code>executeTool</code>.</li>
</ul>

<p>And the honest positioning, straight from OpenAI's own doc: WebMCP is for when the human and the agent look at the <em>same page</em>; backend MCP is for integrations that run without one. A website can do both - so we do: the same 16 tools are reachable in-tab via WebMCP and programmatically via <code>POST /mcp/public</code> JSON-RPC and plain REST. REST stays the source of truth; both facades are thin adapters.</p>

<h2>What can an agent actually do on the site?</h2>

<p><img src="/images/blog/arc-c54-webmcp-site-tools-d1.webp" alt="Stack diagram: browser agents (ChatGPT site tools, Chrome OT) and headless clients on top; a page-scoped TOOLS layer showing different shelves per page plus a shared registry; REST as source of truth with read tools, intake-write and an ops lane; a STORE layer with agentRequest and agentQAPair tables" /></p>
<p><em>One registry, three surfaces: WebMCP in-tab, <code>/mcp/public</code> JSON-RPC, plain REST - all thin adapters over the same endpoints.</em></p>

<p>16 tools today - but <strong>not 16 everywhere</strong>. The point of page scoping is that an agent standing on the scanner page shouldn't see marketplace buttons: <code>document.modelContext.getTools()</code> returns the shelf for <em>that page</em>, from <code>PAGE_TOOLSETS</code> in the shared registry:</p>

<p><img src="/images/blog/arc-c54-webmcp-site-tools-shot-tools.webp" alt="getTools() returns 16 tool names on root; scoped pages show subsets; .well-known/webmcp.json lists the same 16" /></p>
<p><em>Real output: 16 on <code>/</code>, a focused shelf on each scoped page.</em></p>

<ul>
<li><strong>Discovery &amp; trust</strong>: <code>agent-readiness-scan</code>, <code>get-compliance-score</code>, <code>search-rules</code>, <code>verify-verdict</code>, <code>check-address-risk</code>, <code>passport-verify</code>, <code>badge-generate</code></li>
<li><strong>Marketplace</strong>: <code>list-services</code>, <code>browse-tasks</code>, <code>get-task</code>, <code>get-task-status</code></li>
<li><strong>Interaction</strong>: <code>submit-request</code>, <code>poll-request</code>, <code>search-agent-qa</code>, <code>list-surveys</code>, <code>how-to-register</code></li>
</ul>

<p>Read tools are keyless thin wrappers - the same JSON the REST endpoints return, plus one discipline we enforce in every tool description: no secrets, no PII, no internal URLs. <code>agb_</code> credentials never appear in a tool result. Every tool also returns a <code>next_call</code> suggestion - the contract is not "here is data", it is "here is what to call next".</p>

<p>We did not start from zero. A v1 shipped during the hackathon: a declarative scan form plus a handful of imperative tools on <code>/hackathon/webmcp</code> - still live, now registry-driven. V2 is what the v1 taught us: one shared registry instead of scattered registrations, page-scoped shelves instead of everything-everywhere, and a real write path instead of read-only demos.</p>

<h2>How does an agent ask a question - and get an answer?</h2>

<p><img src="/images/blog/arc-c54-webmcp-site-tools-d2.webp" alt="Funnel diagram: discover via webmcp.json/llms.txt/agent-card/mcp-public; read tools; submit-request the only write; poll-request honest waiting through the ops lane; completed with response; consented qa_ pair enters the corpus; search-agent-qa fast-path for the next agent; side lanes for 429, 7-day expiry and retract" /></p>
<p><em>The funnel is deliberately asynchronous: the agent asks, a human answers in hours-to-days, the answer can feed the next agent.</em></p>

<p>There is exactly one write action: <code>submit-request</code>. It posts a question into our ops inbox (the agent request inbox from our previous article - this is its browser-native front). What comes back is deliberately boring:</p>

<p><img src="/images/blog/arc-c54-webmcp-site-tools-shot-submit.webp" alt="submit-request returns request_id rq_3a672b…, state submitted, poll_url and next_call poll-request; a repeat call returns duplicate:true" /></p>
<p><em>A request_id, not an answer. Async is a feature, not a broken chatbot.</em></p>

<p><code>poll-request</code> then returns <code>submitted</code> with <code>retry_after</code> and an honest reason - "ops answers take hours to days (no SLA)". The tool says this out loud because an agent that thinks the pipeline is broken will resubmit, and resubmits hit the per-fingerprint rate limit - which itself answers with a structured <code>http_429</code>, a <code>retry_at</code>, and a <code>next_call</code> that retries <em>itself</em>. Idempotency is deterministic: the same arguments in the same session map to the same <code>request_id</code> (<code>duplicate: true</code>).</p>

<p>Then, on the other side of the wall, an ops human answers. That lane is <code>GET /api/ops/requests</code> + <code>POST /:id/respond</code> behind <code>X-Admin-Key</code> - never exposed through the tools, obviously. And the next poll just works:</p>

<p><img src="/images/blog/arc-c54-webmcp-site-tools-shot-poll.webp" alt="poll-request returns state completed with response.answer text and next_call search-agent-qa" /></p>
<p><em>Verbatim prod: <code>completed</code>, the answer inline, and a suggestion where to look next.</em></p>

<h2>Where do good answers go? A corpus with a consent gate</h2>

<p><img src="/images/blog/arc-c54-webmcp-site-tools-corpus.webp" alt="A glass mailbox labelled submit-request feeding a clerk desk; a consent checkbox is stamped YES before the letter can pass to a PUBLIC QA shelf; a retract lever pulls one letter back out; letters without consent go into a PRIVATE tray" /></p>
<p><em>Private by default, public by consent, reversible always.</em></p>

<p>Every answered request <em>can</em> become public knowledge - but only if the asker opted in. <code>publish_to_qa</code> defaults to <strong>false</strong>: your question and our answer stay yours. When consent is on and the answer exists and the request isn't flagged spam, completing the request materializes a <code>qa_*</code> pair into the public corpus - the thing <code>search-agent-qa</code> reads and the fast-path that answers repeated questions instantly, <code>uses</code> counter ticking up per hit. Ops can retract a pair at any time and it drops out of search and matching, idempotently.</p>

<p><img src="/images/blog/arc-c54-webmcp-site-tools-shot-qa.webp" alt="GET /api/requests/qa?q=agent returns real qa_ pairs with question, response.answer, uses, published_at, provenance" /></p>
<p><em>The corpus as it stands - and an honest empty state when nothing consented exists yet.</em></p>

<p>This is the part we think most agent-facing sites will get wrong, twice: first by publishing everything (a privacy breach with a search box), then by showing an empty corpus as a bug. Ours says what it is: <em>"No public QA answers yet - the corpus only grows from consented, ops-answered requests."</em></p>

<h2>What did production verification actually break?</h2>

<p><img src="/images/blog/arc-c54-webmcp-site-tools-bugs.webp" alt="An inspector robot at a door labelled pg/json; a plain text string slips through the door and explodes a JSON.parse machine behind it; a second panel shows a browser cache box stamped 'max-age=60' being replaced by 'no-store'; green chips read FIXED and re-verified" /></p>
<p><em>Two live catches: a codec that re-parsed strings, and a cache that remembered "submitted" forever.</em></p>

<p>We don't trust our own smoke tests, so the checklist ran on real production Chrome (Origin Trial flag, CDP-driven <code>document.modelContext</code>) and an external agent. It found two shipped bugs - both now fixed with regression tests:</p>

<p><strong>Bug 1 - the stale "submitted".</strong> Our shared cache middleware stamped <code>public, max-age=60</code> on <em>every</em> <code>/api/</code> GET - including the pollable inbox endpoints. So after ops answered, a browser kept serving the cached <code>submitted</code> body for up to a minute while the server truthfully said <code>completed</code>. For a polling agent that's a lie generator. Fix: the inbox route family (<code>/api/requests*</code>, <code>/api/surveys*</code>, <code>/api/ops/requests*</code>) moved to <code>Cache-Control: no-store</code> (<code>54cc6d9</code>).</p>

<p><strong>Bug 2 - the string that broke the codec.</strong> <code>agentRequest.response</code> is a <code>json</code> column. Our Postgres driver returns json columns <em>already parsed</em>; the <code>pg/json</code> codec's decode path then calls <code>JSON.parse</code> <em>again</em> - fine for objects, fatal for a top-level JSON string. We noticed the first time an ops <code>respond</code> call carried a bare string: it wrote fine, then every subsequent read of that row 500'd - including the whole ops queue. Worse, the same class was latent for <em>any</em> bare-string JSON payload: one malformed intake could have poisoned a row for everyone. Fix: coerce at the write edge - a bare-string <code>response</code> becomes <code>{"answer": "…"}</code> (the convention every existing row already used), a bare-string <code>payload</code> becomes <code>{"question": "…"}</code> (<code>4119016</code>). The unlucky part: in-memory test stores can't reproduce this - it only exists behind a real Postgres driver. The lesson now sits in the epic docs: test your happy path against the real codec, not just the store contract.</p>

<p>Everything else the checklist touched was green: 16-tool inventory via both <code>getTools()</code> and <code>/.well-known/webmcp.json</code>, per-page scoping subsets, the declarative v1 form still working, <code>duplicate: true</code> idempotency, consent-on/off QA behavior, retract, the 429 self-retry envelope, and zero <code>agb_</code> leakage in any tool result. 10,768 server tests + 98 e2e + one real browser walk.</p>

<h2>What can you verify right now?</h2>

<p>The read half needs nothing but curl - or a WebMCP browser:</p>

<pre><code># the machine-readable inventory (16 tools)
curl -s https://agentbadge.xyz/.well-known/webmcp.json | jq '.tools | length'

# same tools over JSON-RPC, no key
curl -s -X POST https://agentbadge.xyz/mcp/public \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# the public QA corpus, live
curl -s "https://agentbadge.xyz/api/requests/qa?q=passport"

# in a WebMCP browser (Chrome OT): document.modelContext.getTools()
# on https://agentbadge.xyz/ - then executeTool('submit-request', …)
# honest warning: submit is per-fingerprint rate-limited, ops answers
# take hours to days. If you need it answered, say hi - we're the ops.</code></pre>

<p>A menu isn't a promise that the kitchen is fast - it's a promise that the agent can read it. The page is the registry; the human still writes the letters.</p>
`;
