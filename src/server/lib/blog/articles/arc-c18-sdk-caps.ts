import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c18-sdk-caps",
  title:
    "A Paying Client That Cannot Overspend: Mandatory Caps for x402 Buyer Agents",
  description:
    "An x402 buyer SDK that refuses to construct without PaymentCaps: per-call cap, session budget, strict accepts[] validation (never guess decimals), anti-loop guard, payer-binding headers, and an agentbadge pay CLI with --print-only.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-10",
  dateModified: "2026-10-15",
  tags: ["arc", "ai-agents", "usdc", "x402", "sdk", "caps"],
  readingTime: "6 min",
  shortAnswer:
    "@agentbadge/circle-payments ships a buyer-side x402 client that cannot be created without PaymentCaps {maxPaymentUsd, sessionBudgetUsd} — no uncapped mode. Every 402 response is validated before signing (x402Version=2, scheme/network/asset allowlists, extra.decimals===6 — mis-scale is refused, never inferred); spend is recorded at sign/broadcast, a second 402 after payment-signature throws PaymentNotAcceptedError, and paginateAll counts every page against the session budget. The agentbadge pay CLI enforces the same caps and --print-only shows amount/network/payTo before any signature.",
  agentGuideSlug: "arc-c18-sdk-caps",
  heroImage: "/images/blog/arc-c18-sdk-caps-hero.webp",
  ogImage: "/images/blog/arc-c18-sdk-caps-og.jpeg",
  content: `<p><img src="/images/blog/arc-c18-sdk-caps-hero.webp" alt="A robot agent offers a payment chip to a terminal; a hard-limit dial is pinned at MAX and the chip bounces back along a dashed lane" /></p>
<p>On October 10, 2026, we pointed our own <code>agentbadge pay</code> CLI at our own production API, and it refused to pay us. Three times, three different ways: once for the per-call cap, once for the network allowlist, once for the session budget. Every refusal named the exact field and the exact value. Every refusal happened before a signature existed. The wallet balance did not move by a cent. That is not a bug report; that is the feature working, and this article is about how it works.</p>
<p>An agent shopping a paid API in a loop is a small program holding a credit card. If the API starts returning 402s on every retry, or the agent mis-reads a price that shifted, the loop keeps signing payments until the wallet is empty. The failure is rarely the payment rail. It is the absence of a ceiling. So we built the buyer side of <code>@agentbadge/circle-payments</code> on one premise: <strong>a paying client without limits is a bug, not a default</strong>. There is no uncapped mode. <code>createPayingClient</code> throws a <code>TypeError</code> the moment you omit <code>PaymentCaps</code>, before a single request leaves the process.</p>
<h2 id="mandatory-caps">Why are spending caps mandatory instead of optional?</h2>
<p>Because a cap you can forget is a cap you will forget. The paying client requires <code>{maxPaymentUsd, sessionBudgetUsd}</code> at construction, for example <code>{maxPaymentUsd: "0.50", sessionBudgetUsd: "5"}</code>. Omit them and construction fails with <code>TypeError: PaymentCaps required — refusing to create an uncapped paying client</code>. Passing <code>"0.25"</code> as a number, an empty string, or a non-positive value fails the same way: caps are USD decimal strings validated by regex, and all money math is BigInt on 6-decimal atomic units, never floats.</p>
<p>An optional <code>allowedNetworks</code> array pins which chains the signer may touch. The default is Arc mainnet (<code>eip155:5042</code>) and Arc testnet (<code>eip155:5042002</code>), and the validator enforces it before anything else happens.</p>
<p><img src="/images/blog/arc-c18-sdk-caps-3.webp" alt="Three hexagonal tiles: per-call cap, session budget, network allowlist, each stamped REQUIRED" /></p>
<h2 id="strict-accepts">What does strict accepts validation reject?</h2>
<p>Everything that is not on the contract, and it names what it rejected. Each entry of the <code>accepts[]</code> array in a 402 body must pass five checks: <code>x402Version</code> is <code>2</code>; <code>scheme</code> is one of <code>exact</code>, <code>eip3009-client-broadcast</code>, or <code>gateway-batch</code>; <code>network</code> is in your allowlist; <code>asset</code> equals the USDC address for that chain; and the amount fits under the per-call cap. Every refusal returns <code>{ok: false, reason, field, value}</code> so an agent can log which field killed the payment and with what value.</p>
<p>The sharpest rule is <code>extra.decimals</code>. If a requirement declares decimals other than <code>6</code>, the client refuses rather than guessing, because a mis-scaled amount (6 vs 18 decimals) is a classic footgun in token payments. The safe answer is rejection, not inference.</p>
<p>These are not toy tests. The October 10 run against production produced three live refusals, each before any signing:</p>
<pre><code>refused field=amount value="300000": amount 300000 exceeds per-call cap 10000 (atomic units)
refused field=network value="eip155:84532": network "eip155:84532" not in allowedNetworks
refused: Session budget exhausted: spent 0 + requested 300000 &gt; budget 10000 (atomic units)</code></pre>
<p><img src="/images/blog/arc-c18-sdk-caps-2.webp" alt="A 402 offer card held against a checklist; the decimals=7 line glows amber under a refusal stamp" /></p>
<h2 id="session-budget">How does the session budget stop a runaway loop?</h2>
<p>The client keeps a cumulative <code>SpendTracker</code> for the session, and the reserve happens <strong>before signing</strong>. A 402 response goes through <code>validateAccepts</code> → <code>tracker.tryReserve(amount)</code> → only then does the signer see a typed-data payload. A price above the per-call cap throws <code>CapExceededError</code> carrying <code>{cap, requested}</code>; a price that would push cumulative spend over the budget throws <code>BudgetExhaustedError</code> carrying <code>{spent, budget, requested}</code>. In both cases the signer's <code>signTypedData</code> is never invoked. In our test suite the cap-refusal test asserts exactly that: the wallet mock receives zero signing calls when the price exceeds the cap.</p>
<p>Spend is recorded when money commits, not when a 402 arrives: at settle for facilitator rails, at broadcast for self-settle. An <code>onSpend(entry)</code> hook persists each event to whatever store the operator owns; the SDK keeps memory only for the session.</p>
<p>Two compounding protections sit on the same path. First, an anti-loop guard: if the retried request carrying <code>payment-signature</code> comes back with another 402, the client throws <code>PaymentNotAcceptedError</code> instead of paying twice for the same request. Second, <code>paginateAll</code> treats every paginated page as a payment: cursor-based endpoints iterate until exhaustion, each page debit counts against the session budget, and the budget exception propagates mid-iteration instead of silently retrying.</p>
<h2 id="signing">What does the agent actually sign — and when does money move?</h2>
<p>Signing is scheme-specific, and signing is not spending. For <code>exact</code>, the signer produces an EIP-3009 <code>transferWithAuthorization</code> typed-data signature; the facilitator settles it later, so a signature alone moves no funds. For <code>eip3009-client-broadcast</code> (Arc self-settle), the client broadcasts the USDC transfer itself and spend is fixed at broadcast; when the requirement declares <code>extra.payerBinding</code>, the retry additionally carries <code>X-Wallet</code>, <code>X-Sig</code>, and <code>X-Timestamp</code> headers proving the payer bound the payment to this request (EIP-191, <code>agentbadge-pay:v1</code> challenge). For <code>gateway-batch</code> the client signs the <code>BatchEvmScheme</code> payload, and an opt-in <code>gateway.autoDepositUsd</code> option tops up the Gateway wallet before the request instead of failing at settle.</p>
<p>The October 10 run put numbers on the signing-vs-spending gap. Three paid attempts against production hit a server 500 after <code>payment-signature</code> was accepted; the facilitator never broadcast, and the payer balance went from 20.038 to 19.738 USDC only because of a separate successful local settle of 0.30 USDC (tx <code>0xcc789ccf305d7699cb5fffeee6f89726d06ea2350357e51e2c3d70f6079ef958</code>, block 47933655, on Base Sepolia). Three signatures, zero on-chain settlement on the failed attempts: the ceiling held even when the server did not.</p>
<p><img src="/images/blog/arc-c18-sdk-caps-d1.webp" alt="The paying-client lifecycle: caps gate → validateAccepts → tryReserve → scheme-sign → retry → spend recorded; every refusal exits before signing" /></p>
<p><em>The whole seam in one picture: money can only move through the sign step at the bottom, and you cannot reach it without passing caps, strict accepts validation, and the budget reserve. Every refusal exits with zero spend and a named reason.</em></p>
<h2 id="cli">How do you run it — and verify before signing?</h2>
<p>From code:</p>
<pre><code>const client = createPayingClient({
  caps: { maxPaymentUsd: "0.50", sessionBudgetUsd: "5" },
  signer: viemSigner(walletClient),
});
const res = await client.get("https://agentbadge.xyz/api/total-scan");
// 402 → validateAccepts → cap-check → sign → retry → spend recorded</code></pre>
<p>From the shell, the same caps discipline is enforced by the <code>agentbadge pay</code> CLI. Caps come from flags (<code>--max-payment</code>, <code>--budget</code>) or env (<code>AGENTBADGE_MAX_PAYMENT</code>, <code>AGENTBADGE_BUDGET</code>); the private key comes only from env (<code>AGENTBADGE_PAYER_KEY</code>), never a flag, because argv is visible in <code>ps</code>. Exit codes distinguish outcomes: <code>0</code> ok, <code>2</code> refusal/cap/budget, <code>3</code> transport.</p>
<p><code>--print-only</code> is the buyer's smoke test. It decodes the 402, validates accepts, prints the payment details, and exits without ever touching a signer. This is the real output from the October 10 run against production:</p>
<pre><code>agentbadge pay https://agentbadge.xyz/api/total-scan \\
  --max-payment 0.50 --budget 5 --network eip155:84532 --print-only
# {"scheme":"exact","network":"eip155:84532","asset":"0x036CbD53…",
#  "amountAtomic":"300000","priceUsd":"0.3","payTo":"0x9a66…95A5"}</code></pre>
<p>You can wire it into any agent loop as a pre-flight check for exactly the same validation the paid path enforces.</p>
<p><img src="/images/blog/arc-c18-sdk-caps-4.webp" alt="Terminal frame showing agentbadge pay --print-only output: amount, network, payTo, and a STOP badge" /></p>
<h2 id="contract-verification">Can a client verify the server's contract before paying?</h2>
<p>Yes, because the 402 body the client validates is part of the machine-readable API contract. The server's committed <code>openapi.yaml</code> artifact carries the x402 components (<code>X402PaymentRequired</code>, <code>X402PaymentRequirement</code>, <code>X402HonestRefusal</code>) with <code>x402Version: 2</code>, the scheme enum, <code>extra.decimals: 6</code>, and <code>charged: false</code> pinned as consts. A drift-check in CI (<code>bun run check:openapi</code>) fails if the spec drifts from the live routes. A buyer can diff its <code>validateAccepts</code> expectations against the same artifact the CI enforces; the contract is verified on both sides of the wire, not documented in prose.</p>
<p>Dogfooding caught us too. On the same October 10 run, our catalog declared <code>eip155:5042002</code> (Arc testnet) while the live 402 offered only Base Sepolia (<code>eip155:84532</code>). The default Arc-only allowlist refused the offer until we passed <code>--network</code> explicitly. Our own validator flagged our own catalog drift, which is the kind of failure you want a validator to cause.</p>
<p><em>This is C18 in the Arc Campaign series. Previously: <a href="/blog/arc-c17-honest-refusal">Never Charged for a No: a machine-checkable refusal contract</a>. Next: agent skills — capability-scoped discovery for paid surfaces.</em></p>
<h2 id="for-ai-agents">For AI Agents</h2>
<p>If you are an agent planning to pay for this API:</p>
<ul>
<li><strong>Endpoint catalog</strong>: <code>GET https://agentbadge.xyz/api/v1/services</code> — every SKU carries <code>input_schema</code> (the same object declared in the route's bazaar extension) and <code>price_usd</code></li>
<li><strong>402 contract</strong>: <code>PAYMENT-REQUIRED</code> header/base64 body — <code>{x402Version: 2, accepts[]}</code>; strict fields: <code>scheme</code> (enum above), <code>network</code> (CAIP-2), <code>asset</code> (USDC), <code>amount</code> (atomic), <code>extra.decimals === 6</code>, optional <code>extra.payerBinding</code></li>
<li><strong>SDK</strong>: <code>npm i @agentbadge/circle-payments</code> — <code>createPayingClient({caps, signer})</code> refuses to construct without caps; refusals are typed errors carrying <code>{field, value}</code></li>
<li><strong>CLI</strong>: <code>agentbadge pay &lt;url&gt; --max-payment &lt;usd&gt; --budget &lt;usd&gt; [--print-only]</code> — exit <code>0</code> ok, <code>2</code> refusal, <code>3</code> transport; <code>--print-only</code> validates without signing</li>
<li><strong>Refusals are free</strong>: any <code>4xx/5xx</code> response carries <code>charged: false</code>; self-settled failures produce a <code>refund</code> block</li>
</ul>
<p><strong>Links:</strong> <a href="https://agentbadge.xyz/api/v1/services">Service catalog</a> · <a href="https://agentbadge.xyz/openapi.yaml">openapi.yaml</a> · <a href="https://agentbadge.xyz/llms.txt">llms.txt</a> · <a href="https://www.npmjs.com/package/@agentbadge/circle-payments">Circle payments SDK</a> · <a href="https://agentbadge.xyz">AgentBadge</a></p>
<p><em>Don't certify. Measure.</em></p>`
};
