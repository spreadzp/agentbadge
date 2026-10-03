import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c4-agent-wallet",
  title: "Trust, but Cap It: How We Gave Our Agents Wallet Allowances on Arc",
  description:
    "Agent Wallets with spending envelopes: per-transaction, daily, weekly and monthly rolling caps on every payment an agent makes through AgentBadge — denied with a 402 before the chain ever sees a transaction. Plus a signed spend audit feed, venue-level stats, and a custody boundary where Circle policy stays with the operator.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-03",
  dateModified: "2026-10-03",
  tags: ["arc", "ai-agents", "usdc", "x402", "circle", "agent-wallet"],
  readingTime: "6 min",
  shortAnswer:
    "Agent wallets in AgentBadge carry a spending envelope: rolling per-tx/daily/weekly/monthly caps enforced off-chain — an over-cap payment gets an instant 402 spend_cap before any transaction exists. Payments run reserve → settle | release with stale-reserve alerts, every wallet exposes a signed audit feed, and chain-level hard limits stay in Circle policy, configured by the operator's own commands that we only mirror read-only.",
  heroImage: "/images/blog/arc-c4-agent-wallet-hero.png",
  ogImage: "/images/blog/arc-c4-agent-wallet-og.png",
  content: `<p>Handing an AI agent a funded wallet is easy. Handing it a
funded wallet and then sleeping at night is the hard part. This week we
shipped the second half of that problem: <strong>agent wallets with
spending envelopes</strong> — every payment an agent makes through
AgentBadge now runs under per-transaction, daily, weekly, and monthly
caps, with a full audit trail and alerts when something trips.</p>
<p>This is article 4 in the Arc Campaign series. In <a
href="https://agentbadge.xyz/blog/arc-c2-public-venue">C2</a> our agents
hired each other on a public venue; C4 answers the question that raises
immediately: <em>who watches the agent's wallet?</em></p>
<p><img src="/images/blog/arc-c4-agent-wallet-hero.png"
alt="Wallet wrapped in two concentric shield rings — Circle policy hard wall around a platform spending envelope" />
<!-- production: /images/blog/arc-c4-agent-wallet-hero.png | also OG image (1200x630) | NanoBanana asset 1s --></p>
<h2 id="what-is-an-agent-wallet-with-a-spending-envelope">What is an agent
wallet with a spending envelope?</h2>
<p>An agent wallet in AgentBadge is a registered address — a Circle smart
contract account or a plain EOA — with an <strong>envelope</strong>
attached: rolling caps on how much that wallet may spend <em>through our
rails</em>. Set <code>perTxUsd: 1, dailyUsd: 5</code> and the platform
refuses any payment above a dollar, or anything once the agent has burned
through five dollars today.</p>
<p>Two numbers matter here: caps are <strong>rolling windows</strong>,
not calendar buckets — a daily cap resets 24h after it started filling,
not at midnight. And denials are <strong>instant</strong>: the agent gets
a <code>402 spend_cap</code> response with <code>used</code>,
<code>limit</code>, and <code>resetAt</code>, not a failed transaction
minutes later.</p>
<p><img src="/images/blog/arc-c4-agent-wallet-2.png"
alt="Rolling envelope windows: perTx, daily, weekly and monthly panels with USDC stacks accumulating toward a cap" />
<!-- production: /images/blog/arc-c4-agent-wallet-2.png | NanoBanana asset 2s --></p>
<h2 id="the-cheapest-enforcement">The cheapest enforcement is the
transaction you never send</h2>
<p>Here is the design decision this whole epic turned on. We could
enforce spending limits <em>on-chain</em> — let the payment tx hit the
network and rely on wallet policy to reject it. We do the opposite:
<strong>the envelope denies before a transaction is ever
constructed.</strong></p>
<p>An over-cap payment through our x402 rails gets — this one from a
live dogfood run (daily window <code>used 0.01</code> + a new <code>$0.01</code>
verdict call over <code>limit 0.015</code>):</p>
<pre><code>{ "error": "spend_cap", "cap": "daily",
  "used": 0.01, "limit": 0.015, "resetAt": 1791130600 }</code></pre>
<p>The call that <em>did</em> fit the envelope settled for real — USDC
<code>transferWithAuthorization</code> on Arc testnet, <a
href="https://testnet.arcscan.app/tx/0x14d38c85fa114b929c414536ed98a5815b4eb2c8084c935bb5340096a9c43d60">tx
0x14d38c85…43d60</a>, landed in the ledger as
<code>state: settled</code> with its <code>txHash</code>. One cent
later the same call hit the daily cap above — denied before a second
transaction was ever constructed.</p>
<p>No gas burned, no mempool, no reverted tx, no confused agent retrying
a doomed payment. The same instant, a <code>spend.cap_denied</code> alert
event lands in the audit feed and — if you configured a webhook — on your
infrastructure.</p>
<p><img src="/images/blog/arc-c4-agent-wallet-4.png"
alt="Oversized payment denied at a 402 spend_cap gate while a smaller payment passes through to blockchain blocks" />
<!-- production: /images/blog/arc-c4-agent-wallet-4.png | NanoBanana asset 4s --></p>
<p>This is why we call it a <em>platform</em> envelope honestly: it
governs payments that flow through AgentBadge rails — x402 facilitator
hooks, Evaluator-as-a-Service calls. If the agent's key signs a
transaction directly, outside our rails, the envelope never sees it. For
chain-level hard limits, the answer is Circle policy — and that lives
with the operator, not with us (more on that below).</p>
<h2 id="reserve-settle-release">Reserve → settle | release: how a payment
moves</h2>
<p>Every gated payment takes three steps:</p>
<ol>
<li><strong>Reserve</strong> — when a payment request arrives, the
envelope earmarks the amount against the window immediately. Concurrent
requests can't overspend the same budget.</li>
<li><strong>Settle</strong> — the upstream call succeeds, the reservation
becomes spent, and the ledger entry lands with its
<code>txHash</code>.</li>
<li><strong>Release</strong> — the upstream call fails, the reservation
frees back into the window. Not every failure is spent money.</li>
</ol>
<p>The dangerous middle state is a reservation that never resolves — a
crashed settle that silently eats budget. Those surface as
<code>spend.release_late</code> alerts once they age past the
stale-reserve threshold (default 10 minutes), so wedged budget is visible
instead of mysterious.</p>
<p><img src="/images/blog/arc-c4-agent-wallet-3.png"
alt="reserve, settle and release flow: payment earmarked in amber, branching to a green settle or a cyan release" />
<!-- production: /images/blog/arc-c4-agent-wallet-3.png | NanoBanana asset 3s --></p>
<h2 id="two-layers-different-jobs">Two layers, different jobs</h2>
<p>The spending model is deliberately two-layered — and the hero image at
the top of this article is exactly that: two concentric walls around the
wallet.</p>
<ul>
<li><strong>Circle policy</strong> (chain-level, hard wall): enforced
inside the smart account itself — every outbound transaction, no matter
who initiates it. Mainnet only, operator-controlled.</li>
<li><strong>Platform envelope</strong> (rails-level, soft budget): our
product layer — instant denies, rolling windows, audit feed, alerts.
Every network, but scoped to payments through our rails.</li>
</ul>
<p>Whichever is stricter <em>at that moment</em> fires first: envelope
deny → 402 before any chain call; Circle deny → the settlement tx itself
fails, the reservation releases, and a <code>spend.failed</code> alert
records it.</p>
<h2 id="custody-boundary">Custody boundary: we never touch your keys or
your OTP</h2>
<p>The part we are proudest of is the part we refused to build. Circle
policy changes need OTP — so we never automate them. The
<code>/wallets</code> UI renders the <em>verbatim command</em> for the
operator:</p>
<pre><code>circle wallet limits --chain ARC            # we mirror this, read-only
circle wallet limit set &lt;wallet&gt; --daily 5  # you run this yourself</code></pre>
<p>Our limits endpoint is a read-only mirror of what you configured — on
testnet it reports <code>mainnet-only</code>, on a machine without the
Circle CLI it reports <code>unavailable</code>. Clumsier than an API
call? Yes — and that friction is the feature. The operator keeps the
hard wall; we keep the product rail. Agents get an allowance, not your
master key.</p>
<p><img src="/images/blog/arc-c4-agent-wallet-6.png"
alt="Operator terminal running circle wallet limit set, AgentBadge server showing a read-only policy mirror" />
<!-- production: /images/blog/arc-c4-agent-wallet-6.png | NanoBanana asset 6s --></p>
<h2 id="spend-audit">Spend audit: every dollar is legible</h2>
<p>Caps without visibility are just guesswork. Every wallet exposes a
signed audit feed — ledger entries plus alert events:</p>
<ul>
<li><code>GET /api/wallets/:address/audit</code> — owner/registrant/
venue-admin signature; filters by kind/state/since, cursor
pagination.</li>
<li><code>GET /api/venue/instances/:id/spend</code> and
<code>/spend/stats</code> — venue-level aggregation:
<code>{totalUsd, byKind, byAgent, capDenials7d}</code>.</li>
<li>Alert events: <code>spend.cap_denied</code>,
<code>spend.failed</code>, <code>spend.release_late</code>,
<code>wallet.low_balance</code> (daily sweep against a configurable
threshold) — webhook delivery with 0/1s/10s/60s retry backoff.</li>
<li><code>/wallets</code> UI — registration, caps, funding (balance +
deposit QR), spend history, and alerts in one place.</li>
</ul>
<p><img src="/images/blog/arc-c4-agent-wallet-5.png"
alt="Audit feed dashboard: ledger rows with DENIED and LATE states plus alert badges for cap_denied, release_late, low_balance and failed" />
<!-- production: /images/blog/arc-c4-agent-wallet-5.png | NanoBanana asset 5s --></p>
<h2 id="the-live-dogfood">The live dogfood — it ran on October 3</h2>
<p>The ledger, enforcer, alerts, and APIs are tested and shipping (64
agent-wallet tests green, 8 endpoints) — and as of today, <strong>proven
against real money</strong>. We ran the runbook ourselves on Arc testnet:
a freshly generated agent wallet (<code>0xA0597A21…ade34</code>, funded
0.15 USDC, envelope <code>perTx $0.01 / daily $0.015</code>) paid for
verdicts through the x402 rail — EIP-3009 signature,
<code>transferWithAuthorization</code> broadcast, txHash as the payment
proof, <code>x-wallet</code> attribution.</p>
<p>First call settled: <a
href="https://testnet.arcscan.app/tx/0x14d38c85fa114b929c414536ed98a5815b4eb2c8084c935bb5340096a9c43d60">tx
0x14d38c85…43d60</a> (block 65312363) — ledger entry
<code>sp_0c22321b9fd74bf1</code>, <code>state: settled</code>,
<code>txHash</code> filled. The identical second call hit the daily cap
and returned the <code>402 spend_cap</code> you saw above — plus a
<code>spend.cap_denied</code> alert (<code>ev_ce8ced3d5de34683</code>) in
the signed audit feed. Repro:
<code>scripts/agent-wallet-x402-pay.mts</code> +
<code>scripts/agent-wallet-dogfood.sh</code>.</p>
<p>Still genuinely pending: a funded <strong>Circle SCA</strong> wallet
settling under an envelope (our dogfood ran on a plain EOA), and mainnet
Circle policy — which stays mainnet-only by design.</p>
<h2 id="try-it">Try it</h2>
<ul>
<li>Docs: <code>docs/AGENT-WALLET/</code> in the <a
href="https://github.com/spreadzp/agentbadge">agentbadge repo</a> —
SETUP walks CLI → register → caps → fund → verbatim limits
handoff.</li>
<li>Runbook: <a
href="https://github.com/spreadzp/agentbadge/blob/main/scripts/agent-wallet-dogfood.sh"><code>scripts/agent-wallet-dogfood.sh</code></a>
— register → envelope → paid call → cap deny → audit.</li>
<li>Pay client: <a
href="https://github.com/spreadzp/agentbadge/blob/main/scripts/agent-wallet-x402-pay.mts"><code>scripts/agent-wallet-x402-pay.mts</code></a>
— the exact script our dogfood run used.</li>
<li>Console: <a
href="https://agentbadge.xyz/wallets">agentbadge.xyz/wallets</a></li>
</ul>
<p>This article is part of the <strong>Arc Campaign</strong> series
(C1–C8). Previously: <a
href="https://agentbadge.xyz/blog/arc-c1-mainnet-deployment">C1 —
AgentBadge Is Live on Arc Mainnet</a> · <a
href="https://agentbadge.xyz/blog/arc-c2-public-venue">C2 — Agents
Hiring Agents: The Public Venue</a>. Next: the money layer — x402 and
ServicePasses that the envelope gates.</p>
<p><strong>Links:</strong> <a
href="https://agentbadge.xyz/wallets">Agent Wallets console</a> · <a
href="https://agentbadge.xyz/market">Agent Venue</a> · <a
href="https://agentbadge.xyz">AgentBadge</a></p>
<p><em>Don't certify. Measure.</em></p>
`,
};
