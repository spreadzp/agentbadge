/**
 * EPIC-242 · EPIC-162 C47 — Circle Agent Services Marketplace listing (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c47-circle-marketplace/AgentBadge-Blog.md
 */
export const arcC47CircleMarketplaceContent = `
<h2>Agents don't browse your website. They query an index.</h2>

<p> A human finds a service on a marketplace page. An agent finds it in a machine-readable index — in Circle's case, <code>GET https://api.circle.com/v2/x402/discovery/resources</code>. That endpoint is the actual storefront: 2,650 resources when we checked, each carrying its <code>accepts[]</code> payment terms and provider metadata. The HTML catalog is a rendering of it, not the other way around. </p>

<p> So the question "are we listed?" has a precise, checkable answer — and today it's no: </p>

<pre><code>curl -s 'https://api.circle.com/v2/x402/discovery/resources?query=total-scan' \\
  | jq '.items[].resource'
# → empty while pending_review</code></pre>

<p> One caveat we hit immediately: <code>?query=</code> matches fuzzily — <code>agentbadge</code> returned <code>anchor-x402</code> on an "agent" substring. The reliable check is the resource URL or your payout wallet in <code>accepts[].payTo</code>, not the name. </p>

<h2>What we submitted</h2>

<table>
  <thead><tr><th>Field</th><th>Value</th></tr></thead>
  <tbody>
    <tr><td>Service</td><td>AgentBadge Agent-Readiness Scan</td></tr>
    <tr><td>Endpoint</td><td><code>POST https://agentbadge.xyz/api/total-scan</code></td></tr>
    <tr><td>Payment</td><td>x402, USDC on Arc (<code>eip155:5042002</code>), EIP-3009 <code>transferWithAuthorization</code></td></tr>
    <tr><td>Flow</td><td>agent hits endpoint → 402 with price → signs authorization → gets the scan</td></tr>
  </tbody>
</table>

<p> No API keys, no accounts, no custodial anything. The buyer is an agent; the payment is a signed authorization the facilitator settles on-chain. </p>

<figure class="article-image">
  <img src="/images/blog/arc-c47-circle-marketplace-d1.webp"
       alt="Sequence diagram of the listing lifecycle and the buyer flow: operator submits the service to the marketplace form; the Discovery API index stays empty while status is pending_review; once approved the item is indexed and a buyer agent can browse the catalog, hit POST /api/total-scan, get a 402 with price/payTo/network, retry with a PAYMENT-SIGNATURE carrying the EIP-3009 authorization, the facilitator settles USDC on Arc, and the endpoint returns 200 with the scan report" />
  <figcaption> The loop, end to end: form → review → index → agent → 402 → settle → report. </figcaption>
</figure>

<h2>The honest-status decision</h2>

<p> Here's the part we almost got wrong by convention. Once we added the marketplace to our machine-readable surfaces, the natural status to write was <code>listed</code>. It will be true eventually — probably. But today it isn't, and an LLM agent reading our llms.txt or skill.json has no way to know that "listed" means "we submitted a form." </p>

<p> So a single registry — <code>marketplace-listings.ts</code> — feeds all four surfaces, and the status is <code>pending_review</code>: </p>

<ul>
  <li><strong><code>/llms.txt</code></strong> — a <code>Distribution</code> section naming the marketplace, endpoint, and rail</li>
  <li><strong><code>/skill.json</code></strong> — <code>ab:distribution</code> with the full listing records</li>
  <li><strong><code>/.well-known/agentbadge.json</code></strong> — <code>marketplace_listings</code> in the deployment descriptor</li>
  <li><strong>Organization JSON-LD</strong> — <code>sameAs</code> pointing at the catalog</li>
</ul>

<figure class="article-image">
  <img src="/images/blog/arc-c47-circle-marketplace-surfaces.webp"
       alt="One emerald ledger — marketplace-listings.ts — fanning out to four glowing screens: llms.txt Distribution section, skill.json ab:distribution, agentbadge.json marketplace_listings, and a JSON-LD sameAs link, each showing the same Circle Marketplace pending_review chip" />
  <figcaption> One registry, four surfaces — the status propagates, so "listed" flips everywhere at once. </figcaption>
</figure>

<p> When approval lands, one string changes — <code>pending_review</code> → <code>listed</code> — and every surface updates itself. The same mechanism protects us the other direction: if a listing gets delisted, we can't forget to update the JSON-LD. </p>

<p> <strong>The principle:</strong> don't claim listings you don't have. Services advertising marketplace presence that the discovery index doesn't return are teaching agents to distrust metadata — and the agent that trusts a stale claim fails at checkout, not at marketing. </p>

<figure class="article-image">
  <img src="/images/blog/arc-c47-circle-marketplace-discovery.webp"
       alt="A terminal with a curl + jq query reading a JSON array beside a catalog shelf of 2650 glowing x402 resource tiles; a magnifier lights up the matching tile while an amber sign warns about fuzzy name matching" />
  <figcaption> The index is the ground truth. Verify by <code>resource</code> and <code>payTo</code> — never by name alone. </figcaption>
</figure>

<h2>We built the telemetry before the first sale</h2>

<p> A listing that goes live while your settlement errors are invisible is a listing you find out about from a support ticket. So before submission we shipped the observability pack: </p>

<ul>
  <li><strong>Settle-failure alerts</strong> — every x402 settle failure fires to Telegram/Discord, deduped by error reason over 15 minutes. Verify failures stay log-only: a bad signature isn't a business event, a broken settle is.</li>
  <li><strong><code>GET /api/ledger/revenue?days=N</code></strong> — ops rollup of paid legs: total, byDay, byEndpoint. A nonzero <code>total</code> is the earliest possible "someone paid" signal.</li>
  <li><strong>Revenue in the ops digest</strong> — <code>x402Revenue</code> block with top endpoints rides the daily summary we already send ourselves.</li>
</ul>

<p> And a subtle bug the tests caught: the econ-events schema was stripping the <code>endpoint</code> field the settle legs carried, so revenue-by-endpoint silently never attributed anything. Fix went upstream — <code>@agentbadge/econ-events@0.1.4</code> — because attribution that only works on new fields is attribution that lies about the past. </p>

<h2>What happens on approval</h2>

<ol>
  <li>The Discovery API query returns our <code>items[]</code> entry — <code>resource</code>, <code>accepts[]</code>, <code>metadata.provider</code>.</li>
  <li><code>pending_review</code> → <code>listed</code> in <code>marketplace-listings.ts</code>; all four surfaces update.</li>
  <li>Verify <code>accepts[].network</code> = <code>eip155:5042002</code> and <code>payTo</code> = our wallet — the catalog rendering can lag the index.</li>
  <li>Screenshot the catalog card, swap this article's hero, publish.</li>
</ol>

<p> If review stalls past a few days, Circle's escalation path is documented (<code>help.circle.com</code> support form, or a ticket in the Build on Arc Discord). Manual review queues are a feature, not a bug — a marketplace that indexes without review is a spam list. </p>

<hr/>

<p><em> Status as of writing: submitted 2026-11-12, pending review. Check the index yourself — the command above is the same one we're watching. </em></p>
`;
