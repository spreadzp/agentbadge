import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c10-payer-binding",
  title: "A txHash Is a Bearer Token — We Bound Ours to the Wallet That Paid",
  description:
    "On Arc's self-settle x402 rail the txHash is a bearer credential — public in the mempool, spendable by whoever presents it first (Attack I-B). agentbadge-pay:v1 binds the payment to the payer's wallet: an EIP-191 signature over wallet/method/path/payref/timestamp, checked against the on-chain Transfer.from before the replay slot is ever touched.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-08",
  dateModified: "2026-10-08",
  tags: ["x402", "arc", "ai-agents", "usdc", "web3", "payments", "security"],
  readingTime: "6 min",
  shortAnswer:
    "Payer binding (agentbadge-pay:v1) prevents payment sniping on self-settle x402: the payer signs a canonical challenge naming their wallet and the txHash; the server recovers the signer and compares it to the on-chain Transfer.from BEFORE claiming the replay slot — so a sniper's rejection never consumes the victim's payment.",
  agentGuideSlug: "arc-c10-payer-binding",
  heroImage: "/images/blog/arc-c10-payer-binding-hero.png",
  ogImage: "/images/blog/arc-c10-payer-binding-og.png",
  content: `<p>On Arc's self-settle payment rail the buyer broadcasts the USDC <code>transferWithAuthorization</code> themselves and hands the server the <strong>transaction hash</strong> as proof. Convenient — and a bearer credential: the txHash sits in the public mempool before it confirms, and whoever presents it to the paid endpoint <em>first</em> gets the content. This week we closed that hole on every AgentBadge paid surface with <code>agentbadge-pay:v1</code> — a one-line signature that binds a payment transaction to the wallet that made it, verified <em>before</em> the replay slot is ever touched.</p>
<p>This is article C10 in the Arc Campaign series. It completes the payment-hardening arc started by <a href="https://agentbadge.xyz/blog/arc-c4-agent-wallet">C4</a> (wallet allowances) and <a href="https://agentbadge.xyz/blog/arc-c13-owner-controls">C13</a> (owner controls): those decide <em>what a wallet may spend</em> — this one decides <em>who is allowed to present a payment</em>.</p>
<p><img src="/images/blog/arc-c10-payer-binding-hero.png" alt="A transaction hash being pulled out of a public mempool by a second bot — the paid request that wasn't yours" /></p>
<h2 id="attack">Can someone else spend your agent's payment?</h2>
<p>On the self-settle rail, yes — if the endpoint only looks at the txHash. The attack is Attack I-B from the x402 threat analysis (arXiv:2605.11781) and it's mechanical:</p>
<ol>
<li>Your agent pays — broadcasts the USDC transfer and waits for the response.</li>
<li>A sniper reads the txHash straight out of the mempool, builds its own <code>PAYMENT-SIGNATURE</code> payload pointing at <em>your</em> transaction, and fires it at the paid route first.</li>
<li>The server sees a valid, unspent txHash, consumes the replay slot, and serves the sniper. When your agent's real request arrives, it's a "replay" — your money paid for someone else's answer.</li>
</ol>
<p>The txHash is proof a payment happened. It is not proof that the request came from the payer.</p>
<p><img src="/images/blog/arc-c10-payer-binding-d1.webp" alt="Attack flow: victim broadcast → mempool → sniper races the request with the foreign txHash → the first presenter wins the replay slot" /></p>
<h2 id="mechanics">What does payer binding actually check?</h2>
<p>The fix adds three headers to a payment request — <code>X-Wallet</code>, <code>X-Sig</code>, <code>X-Timestamp</code> — carrying an EIP-191 signature over a canonical challenge string:</p>
<pre><code class="language-text">agentbadge-pay:v1
wallet:&lt;payer address, lowercase&gt;
method:POST
path:/api/eaas/verdicts
payref:&lt;txHash, lowercase&gt;
timestamp:&lt;unix seconds, ±300s drift&gt;</code></pre>
<p>Server-side, the check happens <strong>before</strong> payment verification — order matters, because verification is what burns the replay slot:</p>
<ol>
<li><code>inspect()</code> the receipt <strong>without claiming</strong> — read the USDC <code>Transfer</code> log, extract the on-chain <code>from</code>. The dedup store is untouched, so a rejection never poisons the payment. (Peek and verify share a 30-second receipt cache — the whole check costs one RPC call.)</li>
<li>Recover the EIP-191 signer of the challenge and compare it to <code>X-Wallet</code> <em>and</em> to the on-chain payer. A valid signature over someone else's txHash is still a rejection — that's the snipe.</li>
<li>Reject with <code>403 WRONG_SIGNER</code> (or <code>402 payer_binding_required</code> when headers are absent on a txHash payload). Gateway and exact-rail payments carry no txHash, so they skip binding entirely.</li>
</ol>
<p>The sniper can still see your txHash — it just can't turn it into a ticket anymore. Presenting it now requires <em>your</em> signature, and a rejected attempt leaves the slot intact for your real request. The e2e snipe test proves the ordering: attacker's foreign-txHash request gets 403 with <code>seenTxHashes</code> empty; the legit request then goes through 200; a third call hits replay-402 — the slot lifecycle, intact.</p>
<p><img src="/images/blog/arc-c10-payer-binding-d2.webp" alt="Bound flow: sign agentbadge-pay:v1 → X-Wallet/X-Sig/X-Timestamp → claim-free receipt peek → signer==payer compare → verify, claim, settle" /></p>
<p><img src="/images/blog/arc-c10-payer-binding-1.webp" alt="Challenge string anatomy — the five canonical fields of agentbadge-pay:v1" /></p>
<h2 id="pay-with-binding">How does an agent pay with binding enabled?</h2>
<p>When the gate is on, every 402 advertises it — <code>extensions.payerBinding</code> and each <code>accepts[].extra.payerBinding</code> carry <code>{required: true, challenge: "agentbadge-pay:v1", headers: [...]}</code>. Full spec lives at <a href="https://agentbadge.xyz/payer-binding.md">https://agentbadge.xyz/payer-binding.md</a>.</p>
<p>Client-side it's three extra lines — <code>buildPayerChallenge</code> builds the string, <code>signPayerChallenge</code> signs it:</p>
<pre><code class="language-typescript">import {
  buildPayerChallenge,
  signPayerChallenge,
} from "@agentbadge/circle-payments";

const timestamp = Math.floor(Date.now() / 1000);
const signature = await signPayerChallenge(account, {
  wallet: account.address,
  method: "POST",
  path: "/api/eaas/verdicts",
  payRef: txHash,      // the tx you just broadcast
  timestamp,
});

fetch("https://agentbadge.xyz/api/eaas/verdicts", {
  method: "POST",
  headers: {
    "payment-signature": paymentB64, // x402 payload with txHash
    "x-wallet": account.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
  },
  body: JSON.stringify(payload),
});</code></pre>
<p><img src="/images/blog/arc-c10-payer-binding-2.webp" alt="Request anatomy — PAYMENT-SIGNATURE plus the three binding headers" /></p>
<h2 id="verify-yourself">How do you verify a bound request yourself?</h2>
<p>The binding is checkable without trusting us. Two facts, one receipt:</p>
<ul>
<li><strong>The signature</strong> — <code>recoverMessageAddress</code> over the canonical challenge yields <code>X-Wallet</code>. Anyone can rebuild the exact string — the spec is public and the format is five lines.</li>
<li><strong>The payer</strong> — the txHash's USDC <code>Transfer(from, to, value)</code> log gives the on-chain payer. If the two don't match, the request is a snipe attempt — no matter how valid the signature looks.</li>
</ul>
<p>That's the decoder story: no registry, no allowlist, no server state — a signature, a receipt, and a comparison anyone can re-run.</p>
<p><img src="/images/blog/arc-c10-payer-binding-3.webp" alt="Peek vs claim — the receipt is read without burning the replay slot" /></p>
<h2 id="vs-redeem-token">Why a signature and not a redeem token?</h2>
<p>The same hole is closed elsewhere by a server-issued <code>redeem_token</code> — a two-phase quote → pay → redeem where only the quote holder can present the payment. That works, but it's a second round-trip and a server-side token store per payment.</p>
<p>Ours is stateless. The replay dedup (<code>txHashStore</code>) already existed; the binding rides inside the same request as the payment proof. A sniper that grabbed the txHash still can't produce a signature over a challenge that names its <em>own</em> wallet as payer of that tx — the on-chain <code>from</code> won't match. Stateless, one round-trip, and the challenge format is stable enough for agents to cache.</p>
<p><img src="/images/blog/arc-c10-payer-binding-4.webp" alt="Comparison card — stateless payer binding vs two-phase redeem_token" /></p>
<h2 id="honest-status">Honest status</h2>
<p>Shipped across five paid surfaces — EaaS, marketplace, scan-packs, keeperhub, bstock — behind <code>PAYER_BIND_ENABLED</code> (off until production dogfood) with a per-group kill-switch <code>PAYER_BIND_DISABLED_GROUPS</code>. The snipe lifecycle is proven in an e2e test on the real stack — real <code>createArcSelfSettleHandle</code>, real router, real EIP-191 recovery — and a live dogfood script (<code>scripts/payer-bind-dogfood.mts</code>) replays the attack on testnet: funded <code>PAYER_KEY</code> + a stranger <code>ATTACKER_KEY</code>, and it asserts 403 → 200 → replay-402 in order.</p>
<p>The remaining gap is deliberate: the gate ships off by default until a funded testnet run confirms third-party clients bind correctly — the dogfood script is the last check before flipping it on.</p>
<h2 id="try-it">Try it</h2>
<pre><code class="language-bash"># the spec (machine-readable, for agents)
curl -s https://agentbadge.xyz/payer-binding.md

# the live snipe test (needs Arc testnet USDC on PAYER_KEY)
ENDPOINT=https://agentbadge.xyz \\
PAYER_KEY=0x... ATTACKER_KEY=0x... \\
bun run scripts/payer-bind-dogfood.mts</code></pre>
<ul>
<li>Binding spec + helpers: <code>packages/circle-payments/src/payer-bind.ts</code> — <code>buildPayerChallenge</code>, <code>signPayerChallenge</code></li>
<li>Claim-free peek: <code>arc-self-settle.ts</code> <code>handle.inspect()</code></li>
<li>E2E proof: <code>hackathon/server/tests/payer-binding-e2e.test.ts</code></li>
</ul>
<p><em>This is C10 in the Arc Campaign series. Earlier: C15 turned every 402 into a self-declaring catalog entry; C4 and C13 built the wallet controls this binding sits behind.</em></p>
<p><em>Don't certify. Measure.</em> — and now, don't just measure: bind the payment to the wallet that made it.</p>`,
};
