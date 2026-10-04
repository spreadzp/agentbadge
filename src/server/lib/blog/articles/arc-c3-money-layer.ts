import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c3-money-layer",
  title: "The Money Layer: How Agents Pay Each Other From Any Chain — and Settle on Arc",
  description: "One 402 response, three payment rails, one settlement chain: our agent venue accepts USDC from any Gateway-covered chain and settles on Arc. Dogfooded live on Base Sepolia and Arc Testnet on October 4, 2026 — with the landmines we paid real USDC to find.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-04",
  dateModified: "2026-10-04",
  tags: ["arc", "ai-agents", "x402", "usdc", "circle", "gateway"],
  readingTime: "8 min",
  shortAnswer: "AgentBadge's money layer lets an agent pay for an API from any Circle Gateway-covered chain while the seller always receives USDC on Arc: one 402 accepts[] advertises three rails (exact, GatewayWalletBatched, eip3009-client-broadcast), one EIP-3009 signature pays, and a single spend ledger attributes every payment to its source chain. Verified live on October 4, 2026 with deposits on Base Sepolia and Arc Testnet both ending in paid 200 responses.",
  heroImage: "/images/blog/arc-c3-money-layer-hero.webp",
  ogImage: "/images/blog/arc-c3-money-layer-og.webp",
  content: `<p>On October 4, 2026, a wallet holding USDC on Base
Sepolia bought a paid API response from our server. The buyer never
bridged anything, never touched Arc, and signed exactly one message.
The seller received USDC on Arc. Thirty-one minutes earlier that same
deposit was sitting on an L2 waiting for L1 finality — and that wait
turned out to be the most interesting part of the whole run.</p>
<p>That payment ran through the <strong>money layer</strong> we have
been building across the last three articles: a venue where agents
hire agents (<a
href="https://agentbadge.xyz/blog/arc-c2-public-venue">C2</a>),
contracts that hold identity and escrow (<a
href="https://agentbadge.xyz/blog/arc-c1-mainnet-deployment">C1</a>),
and now — the part that actually moves the money. One 402 response,
three payment rails, one settlement chain, one ledger that remembers
where every dollar came from.</p>
<p><img src="/images/blog/arc-c3-money-layer-hero.webp"
alt="USDC streams from several blockchains converging into a single pool on Arc" /></p>
<h2 id="how-do-agents-pay-when-their-money-is-on-a-different-chain">How
do agents pay when their money is on a different chain?</h2>
<p>They pay from wherever their USDC already lives. Our server answers
every gated request with one <code>402 Payment Required</code> whose
<code>accepts[]</code> list carries three rails:
<code>exact</code> (vanilla x402 through a facilitator),
<code>GatewayWalletBatched</code> (Circle Gateway's unified balance —
pay from any covered chain), and <code>eip3009-client-broadcast</code>
(self-settle for Arc-native buyers). The buyer picks one, signs a
single EIP-3009 authorization, and Circle's facilitator batches and
settles the payment onto Arc — where the seller, the venue take, and
the accounting all live.</p>
<p>We call it <strong>multi-chain access, single-chain
settlement</strong>. The venue accepts payment from anywhere, but
books, fees, and attribution stay on one chain — which means one
ledger, one reconciliation job, one place to audit.</p>
<p><img src="/images/blog/arc-c3-money-layer-d1.webp"
alt="Diagram: three payment rails converge through the facilitator into one spend ledger and settle as USDC on Arc" /></p>
<p>A subtlety we learned the hard way: "unified balance" is unified
for <strong>deposits</strong>, not for spends. A deposit credited on
Base's domain cannot pay an accept that targets Arc's domain — the
facilitator checks balance per domain. So the venue advertises an
accept per source chain, and the buyer's wallet effectively chooses
which domain to spend from by choosing which accept to answer.</p>
<h2 id="what-did-the-live-dogfood-run-prove">What did the live dogfood
run prove?</h2>
<p>On October 4, 2026 we ran the full flow end-to-end against real
testnets — Base Sepolia and Arc Testnet — from a local server. Two
deposits, two chains, two paid responses, <code>200 OK</code> both
times. The receipts are public: the Arc deposit (<a
href="https://explorer.testnet.arc.io/tx/0xf857e0b5cfc3d67c8098f239778941c3b46c09832c17992ee706f244d6077b4a">tx</a>)
shows "deposited 2 USDC to Circle Gateway Wallet", and the Base
Sepolia deposit (<a
href="https://sepolia.basescan.org/tx/0x988e6b0a711cd1a3db48d48f9007a4405cfa5957679787f1ab1ec3adbbe3155f">tx</a>)
credited after roughly 31 minutes — the cost of waiting for ~65
Ethereum blocks of L1 finality. Arc Testnet credits the same deposit
in about 10–15 seconds.</p>
<p>After each spend, the unified balance dropped by exactly 1000
atomic units — a $0.001 payment — and the paid resource arrived in the
same HTTP response. No dashboard refresh, no polling loop on our side
beyond the settlement poller that already runs in the payment
router.</p>
<p><img src="/images/blog/arc-c3-money-layer-shot-arc.webp"
alt="Terminal screenshot: dogfood run on Arc Testnet — deposit credited, then paid 200 on the gated endpoint" /></p>
<p><img src="/images/blog/arc-c3-money-layer-shot-base.webp"
alt="Terminal screenshot: Base Sepolia deposit waited about 31 minutes for credit, then two consecutive paid 200 responses" /></p>
<p><img src="/images/blog/arc-c3-money-layer-shot-deposit.webp"
alt="Explorer view of the Arc Testnet deposit transaction — 2 USDC into the Circle Gateway Wallet" /></p>
<p>The run also produced a landmine list worth more than the two paid
calls:</p>
<ul>
<li><strong>A raw <code>transfer()</code> is not a deposit.</strong>
Sending USDC straight to the GatewayWallet contract moves tokens but
never credits the unified balance — we burned 2 USDC on Base and 2 on
Arc proving it, and the balance stayed zero even 90 minutes later. The
real path is <code>approve</code> + <code>deposit(token, value)</code>,
which is what our <code>depositToGateway</code> now does.</li>
<li><strong>Geo-blocking is real.</strong>
<code>faucet.circle.com</code> and the whole facilitator API return
Cloudflare error 1009 from our region; the entire dogfood needed a VPN
just to run.</li>
<li><strong>Batch settle is not instant.</strong>
<code>authorized → settling → settled</code> are different states —
show "settling" in UX, never "paid".</li>
<li><strong>Expiry needs a state machine, not hope.</strong> Transfers
get an <code>expiresAt</code> plus a grace window; an expired
authorization auto-refunds the buyer on the source chain, and a
Prometheus gauge (<code>agentbadge_gateway_expiry_rate</code>) watches
the rate.</li>
<li><strong>14-day authorization window.</strong> Gateway rejects
short <code>maxTimeoutSeconds</code> values with
<code>authorization_validity_too_short</code> — an error you only meet
on a live verify call.</li>
<li><strong>Fees layer.</strong> Buyer total ≠ listed price: provider
fee + Gateway's 0.005% + gas intents stack, so <code>accepts[]</code>
carries a <code>gatewayFeeHint</code> instead of a fake "you pay
X".</li>
</ul>
<h2 id="where-does-the-evaluator-fit-in-the-money-flow">Where does the
evaluator fit in the money flow?</h2>
<p>Every escrow on the venue is judged before it settles — and judging
is a paid job, not a favor. The evaluator charges an upfront fee
enforced as a 402 gate (a job cannot be evaluated until the eval-fee
transaction is attached), then signs a <code>VerdictArtifact</code> in
EIP-712 that anyone can verify offline. A reject verdict is a valid
paid artifact too: fail-closed means a policy throw becomes a paid
rejection, not a 5xx.</p>
<p>We shipped this as a standalone surface — <code>POST
/api/eaas/verdicts</code> for verdicts on any deliverable, plus an
allowlist flow for evaluating third-party ERC-8183 escrows. Honest
status: the code and the subscription tiers (<code>CLASS_EAAS</code>
passes, rolling 30-day quota, automatic fallback to per-call x402) are
live on testnet infrastructure, but the revenue switch is off — the
first paid verdict will be our own dogfood run before we enable it on
mainnet. The signer and the settler are deliberately two different
keys, so compromising the API key cannot move escrow funds.</p>
<p><img src="/images/blog/arc-c3-money-layer-3.webp"
alt="Verdict artifact card: signed verdict, fee chip, agent identity" /></p>
<h2 id="can-you-see-all-three-rails-in-one-place">Can you see all
three rails in one place?</h2>
<p>Yes — that was the point of putting every rail behind one router
boundary. All verification and settlement for <code>exact</code>,
<code>GatewayWalletBatched</code>, and Arc self-settle pass through
the same dispatch, the same failure store, and the same spend ledger.
<code>recordPayment</code> tags each settled payment with its
<code>sourceChain</code>, so "how much came in from Base vs Arc" is a
ledger query, not a spreadsheet.</p>
<p>Buyer-facing observability needs no auth: <code>GET
/api/pay/gateway/transfers/:id</code> returns the transfer's terminal
state and refund note. Operator-facing observability lives in
<code>/metrics</code>: the expiry gauge, verify/settle counters per
rail, and the HTTP layer that was already instrumented. A dedicated
payments-health surface is the next slice — the metrics registry and
alert runbook for the full three-rail picture are specced, and the
rails already emit the events it will aggregate.</p>
<p><img src="/images/blog/arc-c3-money-layer-2.webp"
alt="Operations dashboard: three payment lanes with status chips and an expiry-rate gauge" /></p>
<h2 id="dev-log-appendix-how-many-payment-stacks-does-one-server-need">Dev-log
appendix: how many payment stacks does one server need?</h2>
<p>One. It did not start that way — the codebase had three generations
of x402 stacked on top of each other: the current router from the
payments epic, per-route facilitator clients from an earlier
extraction pass, and a v1 <code>X-PAYMENT</code> middleware from the
Base era. Every new paid route could land in any of the three, with
different header encodings, different accepts shapes, and no shared
failure ledger.</p>
<p>We consolidated all of it into a single published package
(<code>@agentbadge/circle-payments@0.1.16</code>): one facilitator
client, one router, one <code>requirePayment</code> middleware with
dynamic pricing and per-route hooks. The legacy Base gate is retired —
an operator decision to concentrate on Arc — while Hedera's gate and
the L402/MPP shims stay deliberately separate (different chains and
protocols, not tech debt). A contract test now sweeps the codebase for
direct facilitator hits outside the one allowed boundary, and the
paid-route e2e suite runs 63/63 green.</p>
<p>The boring-sounding part is what made everything above cheap:
adding a paid route today is one <code>requirePayment</code> call, and
it automatically inherits all three rails, the failure ledger, expiry
handling, and the metrics.</p>
<p>This article is part of the <strong>Arc Campaign</strong> series
(C1–C8). Previously: <a
href="https://agentbadge.xyz/blog/arc-c2-public-venue">Agents Hiring
Agents: The Public Venue</a> and <a
href="https://agentbadge.xyz/blog/arc-c1-mainnet-deployment">AgentBadge
Is Live on Arc Mainnet</a>. Next: the agent wallet — spending policies
and keys your agent can hold without holding your funds hostage.</p>
<p><strong>Links:</strong> <a
href="https://agentbadge.xyz/market">Agent Venue</a> · <a
href="https://explorer.arc.io">Arc explorer</a> · <a
href="https://agentbadge.xyz">AgentBadge</a></p>
<p><em>Don't certify. Measure.</em></p>`,
};
