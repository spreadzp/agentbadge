import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "bstock-freemium-402",
  title: "Freemium for AI Agents: Free vs Paid Tiers via HTTP 402 on Arc",
  description: "How do you sell freemium to an agent with no card and no checkout form? HTTP 402 + x402: a programmable paywall where the agent pays on-chain in seconds.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-09-23",
  dateModified: "2026-09-24",
  tags: ["x402","http-402","freemium","mcp","ai-agents","micropayments"],
  readingTime: "5 min",
  shortAnswer: "Freemium for AI agents works via HTTP 402: one free request per minute, then a 402 response carrying an x402 payment challenge — the agent pays on-chain and gets a 30-day ServicePass, no account or checkout needed.",
  heroImage: "/images/blog/bstock-freemium-402-hero.png",
  ogImage: "/images/blog/bstock-freemium-402-hero.png",
  content: `<p>Every SaaS has a free tier and a paid tier. But how do you sell the
paid tier when the customer is not a person but a program? An agent has
no card, cannot fill a checkout form, cannot type a CVV.</p>
<p>We solved it with <strong>HTTP 402 Payment Required</strong> — a
status code that waited three decades for its moment. It is not an
error. It is an invoice.</p>
<p>Why does this matter beyond our tracker? Tokenized stocks trade
around the clock, and the traders who watch them increasingly delegate
monitoring to AI agents. An agent that cannot pay for its own data is a
crippled market participant. Machine-payable access — priced in USDC,
settled on Arc, proven on-chain — turns every agent into a full customer
of the market's data infrastructure: no cards, no signups, no humans in
the loop.</p>
<p><img src="/images/blog/bstock-freemium-402-hero.png"
alt="A robot inserts a glowing USDC coin into a turnstile marked 402" />
<!-- production: /images/blog/bstock-freemium-402-hero.png | also OG image | NanoBanana asset #1 DONE --></p>
<figure>
<img src="/images/blog/bstock-freemium-402-d1.png"
alt="Diagram: the freemium gate" />
<figcaption aria-hidden="true">Diagram: the freemium gate</figcaption>
</figure>
<p><em>Every request passes three doors: a live ServicePass means
instant real-time; otherwise the free bucket allows one request per
minute (a snapshot); otherwise the server answers 402 with an invoice.
One USDC transaction (5 USDC on Arc), an on-chain receipt check — and
the agent holds a 30-day ServicePass.</em></p>
<h2 id="how-the-gate-works">How the gate works</h2>
<p>Every request to the tracker passes three checks:</p>
<ol type="1">
<li><strong>Already paid?</strong> If the agent holds a live ServicePass
(a 30-day access token) — data flows immediately.</li>
<li><strong>Free allowance?</strong> One request per minute is free. A
snapshot, not a stream.</li>
<li><strong>Neither?</strong> The server answers 402 and attaches an
invoice to the response: what, to whom, how much.</li>
</ol>
<h2 id="inside-the-invoice">Inside the invoice</h2>
<p>The 402 response is not just text. The <code>PAYMENT-REQUIRED</code>
header carries a machine-readable payment description:</p>
<pre><code>{
  "x402Version": 2,
  "accepts": {
    "scheme": "eip3009-client-broadcast",
    "network": "eip155:5042002",
    "asset": "USDC",
    "amount": "5000000",
    "payTo": "0xcdd2...699d",
    "maxTimeoutSeconds": 345600
  }
}</code></pre>
<p><img src="/images/blog/bstock-freemium-402-3.png"
alt="A 402 Payment Required JSON response with the accepts block highlighted" />
<!-- production: /images/blog/bstock-freemium-402-3.png | NanoBanana asset #3 DONE --></p>
<p>The agent reads it like a price list: the payment scheme (EIP-3009 —
a standardized transfer signature), the network (Arc Testnet), the asset
(USDC), the amount (5 USDC — the six zeros are decimals, the amount is
in base units), the recipient, and the invoice expiry (4 days).</p>
<h2 id="why-not-api-keys-and-billing-portals">Why not API keys and
billing portals</h2>
<p>An API key needs signup, an email, a card, invoices — a human in the
loop. 402 + x402 is a <em>programmable</em> paywall: the agent sees the
price → signs a transfer → pays → gets access. The whole cycle takes
seconds. For a machine, this is the native way to buy things.</p>
<p>And because it runs on <strong>Arc</strong> — Circle's blockchain
where gas itself is paid in USDC — the agent needs exactly one asset in
its wallet. One balance covers the payment and the fee. For a market
where bStocks themselves settle in USDC, the plumbing finally matches
the asset.</p>
<h2 id="one-payment-pays-once">One payment pays once</h2>
<p>After paying, the agent retries the request with the transaction hash
attached. The server checks the blockchain — not a claimed signature,
but the real receipt from a block — and opens access. The same hash
cannot be presented twice: the server atomically claims it, and a second
attempt gets <code>tx_replayed</code>. Even ten parallel requests with
the same hash — exactly one gets through.</p>
<p>A paywall a program can read and pay turns data into a first-class
on-chain service. More agents able to buy real-time data means more eyes
on tokenized markets — tighter deltas, faster convergence, healthier
price discovery for everyone who trades them.</p>
<p><em>Next: the payment itself on Arc — and why gas there is paid in
USDC.</em></p>
<hr />
<p><strong>Links</strong></p>
<ul>
<li>Agent guide (endpoints, limits, examples): <a
href="https://agentbadge.xyz/bstock-guide">agentbadge.xyz/bstock-guide</a></li>
<li>All articles in the series: <a
href="https://agentbadge.xyz/blog">agentbadge.xyz/blog</a></li>
<li>MCP endpoint:
<code>https://agentbadge.xyz/mcp/bstock/tools/get_delta</code></li>
</ul>`,
};
