import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "bstock-arc-x402-payment",
  title: "x402 Payments on Arc Testnet: How an Agent Pays in USDC With No Facilitator",
  description: "On Arc, gas is paid in USDC — so an agent can broadcast its own EIP-3009 transferWithAuthorization and settle x402 payments with no facilitator.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-09-23",
  dateModified: "2026-09-25",
  heroImage: "/images/blog/bstock-arc-x402-payment-hero.png",
  ogImage: "/images/blog/bstock-arc-x402-payment-hero.png",
  tags: ["x402", "arc", "usdc", "eip-3009", "payments", "ai-agents"],
  readingTime: "5 min",
  shortAnswer: "Arc self-settle lets an agent pay x402 invoices with no facilitator: it signs an EIP-3009 transferWithAuthorization, broadcasts it on Arc (gas in USDC), and sends the txHash — the server verifies the on-chain receipt.",

  content: `<p>In classic x402, a <strong>facilitator</strong> sits between the
buyer and the seller: it takes the agent’s signature and broadcasts the
transaction on its behalf. Convenient — but an extra party to trust, an
extra API to wait on, an extra point of failure.</p>
<p>On Arc we skipped it. The scheme is called
<strong>self-settle</strong> — “settle it yourself”.</p>
<figure>
<img src="/images/blog/bstock-arc-x402-payment-d1.png"
alt="Diagram: paying on Arc in 6 steps" />
<figcaption aria-hidden="true">Diagram: paying on Arc in 6
steps</figcaption>
</figure>
<p><em>The agent receives the 402 invoice, signs an EIP-3009
authorization (exactly 5 USDC to the treasury) and broadcasts on Arc
itself — gas is paid in USDC. The server reads the receipt from the
block: the Transfer event reached the treasury — access opens for 30
days.</em></p>
<h2 id="why-arc-makes-this-possible">Why Arc makes this possible</h2>
<p>Arc is a blockchain built by Circle — the company behind USDC. Its
signature feature: <strong>gas is paid in USDC</strong>, not in a
separate token. A conventional agent would need to hold two assets: USDC
for the payment and ETH for gas. On Arc one balance is enough — USDC
covers both the payment and the fee.</p>
<h2 id="the-flow-in-6-steps">The flow in 6 steps</h2>
<ol type="1">
<li>The agent requests data → gets a 402 with the invoice: scheme,
network, amount, recipient.</li>
<li>It signs an <strong>EIP-3009</strong> authorization — the standard
for “transfer with authorization”: a signature that permits moving
exactly 5 USDC from the agent’s wallet to the recipient. Nothing more,
no wallet access.</li>
<li>It broadcasts the transaction itself (hence
“client-broadcast”).</li>
<li>It waits for confirmation — seconds.</li>
<li>It retries the request with the transaction hash attached.</li>
<li>The server reads the blockchain: is the tx in a block, did USDC
reach the treasury, is the amount right → access for 30 days.</li>
</ol>
<figure>
<img src="/images/blog/bstock-arc-x402-payment-2.png"
alt="Six-step pipeline: request, 402 invoice, EIP-3009 signature, broadcast, on-chain receipt, access for 30 days" />
</figure>
<h2 id="what-the-server-actually-verifies">What the server actually
verifies</h2>
<p>Not a signature — a <strong>receipt</strong>. The server asks the
chain for <code>getTransactionReceipt(txHash)</code> and checks: the
transaction is really in a block, it contains a <code>Transfer</code>
event from the USDC contract to the treasury address, the amount covers
the price. This cannot be forged: either the transaction is in a block
or it does not exist.</p>
<figure>
<img src="/images/blog/bstock-arc-x402-payment-3.png"
alt="A block on Arc with a highlighted Transfer log paying 5 USDC to the treasury, inspected by the server" />
</figure>
<h2 id="what-this-gives-the-ecosystem">What this gives the
ecosystem</h2>
<p>Removing the facilitator removes a point of failure and a trust
assumption. Any wallet holding USDC on Arc becomes a payment client: one
asset, one signature, one RPC call. For agents, buying data becomes as
routine as calling an API.</p>
<p><em>Next: when the delta actually pays — free tier vs
real-time.</em></p>
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
