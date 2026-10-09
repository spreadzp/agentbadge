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
  dateModified: "2026-10-10",
  tags: ["arc", "ai-agents", "usdc", "x402", "sdk", "caps"],
  readingTime: "6 min",
  shortAnswer:
    "@agentbadge/circle-payments ships a buyer-side x402 client that cannot be created without PaymentCaps {maxPaymentUsd, sessionBudgetUsd} — no uncapped mode. Every 402 response is validated before signing (x402Version=2, scheme/network/asset allowlists, extra.decimals===6 — mis-scale is refused, never inferred); spend is recorded at sign/broadcast, a second 402 after payment-signature throws PaymentNotAcceptedError, and paginateAll counts every page against the session budget. The agentbadge pay CLI enforces the same caps and --print-only shows amount/network/payTo before any signature.",
  agentGuideSlug: "arc-c18-sdk-caps",
  heroImage: "/images/blog/arc-c18-sdk-caps-hero.png",
  ogImage: "/images/blog/arc-c18-sdk-caps-og.png",
  content: `<p>An agent shopping a paid API in a loop is a small program holding a credit card. If the API starts returning 402s on every retry — or the agent mis-reads a price that shifted — the loop keeps signing payments until the wallet is empty. Every "agent payment" story eventually lands on the same incident report: <em>the retry was correct, the signing was correct, and the money was still gone.</em> The failure wasn't the payment rail. It was the absence of a ceiling.</p>
<p>We built the buyer side of our x402 SDK — <code>@agentbadge/circle-payments</code> — on a single premise: <strong>an agent client that can pay without limits is a bug, not a default</strong>. There is no uncapped mode. <code>createPayingClient</code> throws a <code>TypeError</code> the moment you omit <code>PaymentCaps</code>, before a single request leaves the process.</p>
<p><img src="/images/blog/arc-c18-sdk-caps-hero.png" alt="A robot agent feeding a payment chip into a metered slot; the limit dial is pinned at max and the chip bounces back" /></p>
<h2 id="mandatory-caps">Why are spending caps mandatory instead of optional?</h2>
<p>Because a cap you can forget is a cap you will forget. The paying client requires <code>{maxPaymentUsd, sessionBudgetUsd}</code> at construction — for example <code>{maxPaymentUsd: "0.25", sessionBudgetUsd: "5"}</code>. Passing an undefined caps object fails fast with <code>TypeError: PaymentCaps required — refusing to create an uncapped paying client</code>. An optional <code>allowedNetworks</code> array pins which chains the signer may touch (defaults to Arc mainnet and testnet).</p>
<p>The enforcement happens <strong>before signing</strong>, not after settlement. Each 402 response goes through <code>validateAccepts</code> → <code>tracker.tryReserve(amount)</code> → only then does the signer see a typed-data payload. A price above the per-call cap throws <code>CapExceededError</code> carrying <code>{cap, requested}</code> — and the signer's <code>signTypedData</code> is never invoked. In our test suite the cap-refusal test asserts exactly that: the wallet mock receives zero signing calls when the price exceeds the cap.</p>
<h2 id="strict-accepts">What does strict accepts validation reject?</h2>
<p>Everything that isn't on the allowlist — with named values, not silent coercion. <code>validateAccepts</code> checks each entry of the <code>accepts[]</code> array in the 402 body against a fixed contract: <code>x402Version</code> must be <code>2</code>; <code>scheme</code> must be one of <code>exact</code>, <code>eip3009-client-broadcast</code>, or <code>gateway-batch</code>; <code>network</code> must be in your allowlist; <code>asset</code> must equal the USDC address for that chain; and <code>amount</code> must fit under the cap.</p>
<p>The sharpest rule is <code>extra.decimals</code>: if a requirement declares decimals other than <code>6</code>, the client refuses rather than guessing. A mis-scaled amount — 6 vs 18 decimals — is a classic footgun in token payments; the safe answer is rejection, not inference. Every refusal returns <code>{ok: false, reason, field, value}</code> so an agent can log <em>which</em> field killed the payment and with <em>what</em> value — debugging data for the next request, not a dead end.</p>
<p><img src="/images/blog/arc-c18-sdk-caps-2.png" alt="A 402 offer card held against a checklist; the decimals=7 line glows amber under a refusal stamp" /></p>
<h2 id="session-budget">How does the session budget stop a runaway loop?</h2>
<p>The client keeps a cumulative <code>SpendTracker</code> for the session: <code>spent += amount</code> is recorded when a payment is signed or broadcast — not when a 402 arrives. Before every signing step the tracker checks <code>spent + amount &lt;= sessionBudgetUsd</code>; when the check fails, the client throws <code>BudgetExhaustedError</code> with <code>{spent, budget, requested}</code> so the agent can see exactly how far the runway went. An <code>onSpend(entry)</code> hook persists each spend event to whatever store the operator owns — the SDK only keeps memory for the session.</p>
<p>Two compounding protections sit on the same path. First, an anti-loop guard: if the retried request (carrying <code>payment-signature</code>) comes back with another 402, the client throws <code>PaymentNotAcceptedError</code> — it never pays twice for the same request. Second, <code>paginateAll</code> treats every paginated page as a payment: cursor-based endpoints iterate until exhaustion, each page debit counts against the session budget, and the budget exception propagates mid-iteration instead of silently retrying.</p>
<h2 id="signing">What does the agent actually sign — and what if the wallet is short?</h2>
<p>Signing is scheme-specific and transparent. For <code>exact</code>, the signer produces an EIP-3009 <code>transferWithAuthorization</code> typed-data signature. For <code>eip3009-client-broadcast</code> (Arc self-settle), the client broadcasts the USDC transfer itself — spend is recorded at broadcast — and when the requirement declares <code>extra.payerBinding</code>, the retry additionally carries <code>X-Wallet</code>, <code>X-Sig</code>, and <code>X-Timestamp</code> headers proving the payer bound the payment to this request (EIP-191, <code>agentbadge-pay:v1</code> challenge). For <code>gateway-batch</code> the client signs the <code>BatchEvmScheme</code> payload; if the gateway balance is short, an opt-in <code>gateway.autoDepositUsd</code> option tops up the wallet <em>before</em> the request — the ensureFunded pattern — instead of failing at settle.</p>
<p><img src="/images/blog/arc-c18-sdk-caps-3.png" alt="Three hexagonal cap tiles — per-call cap, session budget, network allowlist — each stamped REQUIRED" /></p>
<h2 id="cli">How do you run it — and verify before signing?</h2>
<p>From code:</p>
<pre><code>const client = createPayingClient({
  caps: { maxPaymentUsd: "0.25", sessionBudgetUsd: "5" },
  signer: viemSigner(walletClient),
});
const res = await client.get("https://agentbadge.xyz/api/total-scan");
// 402 → validateAccepts → cap-check → sign → retry → spend recorded</code></pre>
<p>From the shell, the same caps discipline is enforced by the <code>agentbadge pay</code> CLI — caps come from flags (<code>--max-payment</code>, <code>--budget</code>) or env (<code>AGENTBADGE_MAX_PAYMENT</code>, <code>AGENTBADGE_BUDGET</code>), the private key only from env, and exit codes distinguish refusal/cap (2) from network failure (3):</p>
<pre><code>agentbadge pay https://agentbadge.xyz/api/total-scan \\
  --max-payment 0.25 --budget 5 --print-only
# prints amount, network, payTo — and exits without signing</code></pre>
<p><code>--print-only</code> is the buyer's smoke test: it decodes the 402, validates accepts, prints <code>{amount, network, payTo}</code>, and exits. You can wire it into any agent loop as a pre-flight check for exactly the same validation the paid path enforces.</p>
<p><img src="/images/blog/arc-c18-sdk-caps-4.png" alt="Terminal frame showing agentbadge pay --print-only output: amount, network, payTo, with a STOP badge" /></p>
<h2 id="contract-verification">Can a client verify the server's contract before paying?</h2>
<p>Yes — the 402 body the client validates is now part of the machine-readable API contract. The server's committed <code>openapi.yaml</code> artifact carries the x402 components (<code>X402PaymentRequired</code>, <code>X402PaymentRequirement</code>, <code>X402HonestRefusal</code>) with <code>x402Version: 2</code>, the scheme enum, <code>extra.decimals: 6</code>, and <code>charged: false</code> pinned as consts; a drift-check in CI (<code>bun run check:openapi</code>) fails if the spec drifts from the live routes. A buyer can diff its <code>validateAccepts</code> expectations against the same artifact the CI enforces — the contract is verified on both sides of the wire, not documented in prose.</p>
<p><em>This is C18 in the Arc Campaign series. Previously: <a href="/blog/arc-c17-honest-refusal">Never Charged for a No: a machine-checkable refusal contract</a>. Next: agent skills — capability-scoped discovery for paid surfaces.</em></p>`
};
