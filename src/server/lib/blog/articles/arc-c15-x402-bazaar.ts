import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c15-x402-bazaar",
  title:
    "Your Agent Shouldn't Have to Guess the Price — One Catalog, Declared on Every 402",
  description:
    "AgentBadge now serves a machine-readable paid-services catalog at GET /api/v1/services, and every 402 response across the platform carries an x402 bazaar extension — price, input schema, and free alternatives declared before a single cent moves. One SKU registry feeds the catalog, the wire declarations, and llms.txt; an explicit gate-coverage e2e test fails CI on any new paid route without a SKU.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-08",
  dateModified: "2026-10-08",
  tags: ["x402", "arc", "ai-agents", "usdc", "payments", "service-catalog", "api"],
  readingTime: "6 min",
  shortAnswer:
    "GET https://agentbadge.xyz/api/v1/services returns the paid surface as a SKU registry: price_usd, endpoint, and input_schema per entry plus a free[] section with next_call pointers. Every 402 carries a bazaar extension whose inputSchema is byte-equal to the catalog's — one function, zero drift.",
  agentGuideSlug: "arc-c15-x402-bazaar",
  heroImage: "/images/blog/arc-c15-x402-bazaar-hero.png",
  ogImage: "/images/blog/arc-c15-x402-bazaar-og.png",
  content: `<p>An agent that wants to buy from an API answers three questions before it pays: <em>what does it cost, what do I send, and is there a free way to try it first?</em> Most payment-gated APIs make the agent guess all three — the price lives in a marketing page, the input schema lives in a wiki, and "free tier" is a sales call. This week AgentBadge closed that loop: <code>GET /api/v1/services</code> returns the full machine-readable catalog, and every HTTP 402 response across the platform declares itself for x402 indexers — price, input schema, and free alternatives, before a single cent moves.</p>
<p>This is article 15 in the Arc Campaign series. It builds directly on <a href="https://agentbadge.xyz/blog/arc-c14-agent-discovery">C14</a> (the <code>.well-known</code> discovery surface that helps agents <em>find</em> us) — C15 is what an agent reads once it found us and wants to <em>buy</em> something.</p>
<p><img src="/images/blog/arc-c15-x402-bazaar-hero.png" alt="Catalog JSON and a 402 coin — price before payment" /></p>
<h2 id="one-registry">One registry, three consumers</h2>
<p>The interesting decision wasn't the endpoint — it was what feeds it. We didn't want another hand-maintained list that rots. So the catalog is a declarative <strong>SKU registry</strong> (<code>lib/service-catalog</code>) that reads from the same config sources the payment middleware reads from — the scan-bundle price you see in the catalog is the price the gate will actually charge, because both derive from one source of truth.</p>
<p>That one registry now feeds three consumers: <code>GET /api/v1/services</code> — the JSON catalog for agents and indexers; the <strong>bazaar extension</strong> on every 402 — x402 v2 discovery metadata; and <code>llms.txt</code> — the "Paid Services" section links anchor to <code>/api/v1/services#&lt;sku_id&gt;</code> (from our EPIC-178 discovery work).</p>
<p>Fourteen SKUs across eight paid surfaces today: readiness scans, passport mints, marketplace buys, keeperhub premium scans, eval-as-a-service verdicts/jobs/subscriptions, bstock service passes, and venue instance subscriptions. A SKU looks like this:</p>
<pre><code class="language-json">{
  "sku_id": "eaas:verdict",
  "surface": "eaas",
  "name": "Eval verdict",
  "price_usd": "0.10",
  "endpoint": { "method": "POST", "path": "/api/eaas/verdicts" },
  "auth": "x402",
  "input_schema": {
    "type": "object",
    "properties": { "url": { "type": "string" } },
    "required": ["url"]
  }
}</code></pre>
<p><code>sku_id</code> is <code>surface:slug</code> and immutable once published — it is the public contract agents bookmark and indexers key on. Our coverage test keeps a golden list of all fourteen ids; renaming one fails CI.</p>
<p><img src="/images/blog/arc-c15-x402-bazaar-d1.png" alt="Diagram: live config sources feed one SKU registry, which feeds the catalog endpoint, the bazaar extension on every 402, and llms.txt — with the coverage e2e watching for drift" /></p>
<p><img src="/images/blog/arc-c15-x402-bazaar-1.png" alt="Catalog fragment: services[] with sku_id, endpoint, price_usd and free[] section" /></p>
<h2 id="every-402">Every 402 declares itself (bazaar)</h2>
<p>An x402 "bazaar" extension is metadata inside the 402 response that tells indexers — and paying clients — what the call costs and what the input should look like. The rule we shipped: <strong>every 402 in the platform carries it</strong>, not just the happy-path REST endpoints.</p>
<p>Every payment gate — x402 Hedera, MPP/Stripe, bstock freemium, the manual settle seam behind venue subscriptions, all three EaaS middlewares — now attaches <code>bazaarExtensionFor("&lt;sku_id&gt;")</code> to its payment options. The extension object looks like:</p>
<pre><code class="language-json">{
  "bazaar": {
    "info": {
      "input": { "type": "http", "bodyType": "json",
                 "body": { "url": "https://example.com" } },
      "output": { "type": "json", "example": { "score": 72 } }
    },
    "schema": {
      "properties": { "input": { "properties": {
        "body": { "type": "object",
                  "properties": { "url": { "type": "string" } },
                  "required": ["url"] } } } }
    }
  }
}</code></pre>
<p>The important invariant: <code>schema.properties.input.properties.body</code> is <code>inputSchemaOf(sku)</code> — <em>byte-equal</em> to the schema in the catalog. Nobody hand-copies a schema into a 402; there is exactly one function that produces it, so catalog and wire declaration cannot drift (we wrote that down as decision D-179-4).</p>
<p>Even our L402 (Lightning-style macaroon) gate is accounted for — its challenge is <code>WWW-Authenticate</code>-based with no JSON slot, so it lives on an explicit exception list in the coverage test rather than pretending to carry metadata it can't hold.</p>
<p><img src="/images/blog/arc-c15-x402-bazaar-2.png" alt="402 anatomy: PAYMENT-REQUIRED header decoded to extensions.bazaar" /></p>
<h2 id="free-door">Free as the front door</h2>
<p>A catalog that only lists prices is half a catalog. Agents evaluating a new provider want to <em>try before they trust</em>, so <code>/api/v1/services</code> carries a <code>free[]</code> section alongside <code>services[]</code> — health checks, the scan-packs catalog (<code>GET /api/scan-packs</code>), marketplace browsing — each with a <code>next_call</code> pointer to the natural paid follow-up.</p>
<p>That made the free section an onboarding bridge rather than a footnote: an agent can hit <code>/api/health</code> and <code>next_call</code> points it at the free scan-packs listing; the scan-packs listing explains which paid bundles exist; the paid bundle declares its bazaar schema on the 402. Discovery → free trial → paid call, with zero documentation reading.</p>
<p><img src="/images/blog/arc-c15-x402-bazaar-d2.png" alt="Diagram: the full agent journey — discovery surface to catalog to free endpoint to paid SKU, where the 402 itself carries the bazaar declaration" /></p>
<p><img src="/images/blog/arc-c15-x402-bazaar-4.png" alt="free[] as the onboarding bridge into paid SKUs" /></p>
<h2 id="coverage">No paid endpoint without a declaration</h2>
<p>A registry only stays honest if adding a route without registering it <em>breaks the build</em>. <code>tests/e2e/catalog-coverage.test.ts</code> keeps an explicit <code>GATE_TABLE</code> — every payment gate in the codebase, mapped to the SKU ids that cover its endpoint. The test walks both directions: every gate row must resolve to real SKUs on that endpoint, and every SKU's endpoint must be claimed by a gate row. Then it mounts the real route modules and asserts each SKU endpoint resolves (a Hono bare-404 fails; a handler-level "unknown id" 404 doesn't — we learned that one the hard way with fixture <code>:param</code> values).</p>
<p>Two rows aren't SKUs by design: <code>l402</code> (macaroon challenges, no JSON slot) and <code>attestation-api</code> (internal trust surface, not a product). They sit in <code>GATE_EXCEPTIONS</code> with written reasons — an allowlist that can only grow in code review, never silently.</p>
<p><img src="/images/blog/arc-c15-x402-bazaar-3.png" alt="GATE_TABLE coverage matrix — every gate has a SKU, every SKU a gate" /></p>
<h2 id="honest-status">Honest status</h2>
<p>Shipped across five slices: the SKU registry, <code>GET /api/v1/services</code>, bazaar coverage on every 402 (including the settle-seam <code>PAYMENT-REQUIRED</code> header — that slot was empty before), the <code>free[]</code> section with <code>next_call</code> bridges into <code>llms.txt</code>, and the coverage/drift e2e contract. Deprecated <code>/pricing.json</code> and <code>/api/meta/fees</code> still serve but point at <code>/api/v1/services</code> — additive, no breaking change for existing clients.</p>
<p>What's <em>not</em> here yet: tenant-published market services don't appear in the catalog (they live under <code>/api/market/services</code> and are dynamic — that's O3 on our decisions doc, deliberately out of scope), and the catalog advertises USD prices while the runtime router decides which chains/assets to accept — separation of declaration and settlement is intentional.</p>
<h2 id="try-it">Try it</h2>
<pre><code class="language-bash"># The whole paid surface, one GET:
curl -s https://agentbadge.xyz/api/v1/services | jq '.services[].sku_id'

# Decode a real 402's bazaar declaration:
curl -s -X POST https://agentbadge.xyz/api/total-scan \\
  -H 'content-type: application/json' -d '{}' \\
  -D - | grep -i payment-required | cut -d' ' -f2- \\
  | base64 -d | jq '.extensions.bazaar.info'</code></pre>
<ul>
<li>Catalog implementation: <code>src/server/routes/services-catalog.ts</code> and <code>lib/service-catalog/</code> in the <a href="https://github.com/spreadzp/agentbadge">agentbadge repo</a></li>
<li>Coverage contract: <a href="https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/tests/e2e/catalog-coverage.test.ts"><code>tests/e2e/catalog-coverage.test.ts</code></a> — the GATE_TABLE every new paid route must join</li>
</ul>
<p><em>This is C15 in the Arc Campaign series. Earlier: <a href="https://agentbadge.xyz/blog/arc-c14-agent-discovery">C14</a> built the <code>.well-known</code> surface that gets agents to the door; C15 is what they read at the counter. Next in the pipeline: verdict transparency and keyless signers.</em></p>`,
};
