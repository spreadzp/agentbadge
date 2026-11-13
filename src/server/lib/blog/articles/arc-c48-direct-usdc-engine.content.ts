/**
 * EPIC-222 · EPIC-162 C48 — Direct USDC verification engine (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c48-direct-usdc-engine/AgentBadge-Blog.md
 */
export const arcC48DirectUsdcEngineContent = `
<h2>Why can't you just trust the transaction hash the buyer gives you?</h2>

<p> Because a tx hash is a claim, not a receipt. The buyer says "I sent 9.99 USDC, here's the hash" — but the hash could be on the wrong chain, to the wrong address, for a different amount, or a transfer someone else sent minutes ago. Nothing in a plain ERC-20 Transfer identifies <em>which order</em> it pays for. </p>

<p> So the engine verifies against <strong>expectations</strong>, not events. When a buyer opens a <code>DIRECT_USDC</code> attempt, we issue instructions that make the payment uniquely identifiable: </p>

<ul>
<li> a <strong>reference</strong> derived from the payment ID, </li>
<li> the <strong>treasury recipient</strong> and the <strong>USDC token contract</strong>, </li>
<li> an <strong>exact amount with a deterministic micro-unit suffix</strong> — $9.99 becomes <code>9.990044</code>. Ten buyers, ten distinct amounts, one recipient; matching becomes a lookup, not a guess. </li>
</ul>

<p><img src="/images/blog/arc-c48-direct-usdc-engine-dedupe.webp" alt="Ten identical USDC coins stamped with different micro-amounts flowing toward a single treasury vault, a scanner beam routing each to its own payment slot" /></p>
<p><em> Unique micro-amounts: same recipient, unambiguous payer. </em></p>

<p> This is a live dogfood: a real attempt on <code>eip155:1874</code> (Arc mainnet) — not a mock: </p>

<p><img src="/images/blog/arc-c48-direct-usdc-engine-instructions.webp" alt="Live DIRECT_USDC payment instructions: amount 9.990044 USDC, recipient, Arc tokenContract, reference, one-hour TTL" /></p>
<p><em> The instructions a buyer's wallet gets: exact amount, treasury, USDC contract, reference, 1h TTL. </em></p>

<h2>How is the engine built?</h2>

<p> Chain code lives in the domain package — <code>@agentbadge/payments/src/chain/</code> — as pure functions plus one injectable viem adapter. The server owns only wiring: an env-gated sweeper that polls on a timer. </p>

<p><img src="/images/blog/arc-c48-direct-usdc-engine-d1.webp" alt="Sequence diagram of the USDC payment flow: buyer opens a DIRECT_USDC attempt and receives instructions; the buyer transfers USDC on Arc; the monitor sweeper scans Transfer events on head+cursor, calls confirmPayment through the evidence seam, dispatchFulfillment returns a FulfillmentOutcome; needs-ops or unproven effects file a CRITICAL FULFILLMENT_UNRESOLVED exception, and late/duplicate/fuzzy mismatches file PaymentExceptions" /></p>
<p><em> Every tick is a scan → match → confirm → fulfill-or-flag loop. </em></p>

<p> Three design choices worth stealing: </p>

<ul>
<li> <strong>Same seam as Stripe.</strong> <code>confirmPayment</code> takes a <code>PaymentEvidence</code> whether it came from a signed webhook or a chain scan — the domain service doesn't care which rail proved the money. </li>
<li> <strong>Expectations come from us, not the chain.</strong> The monitor loads pending attempts (<code>listPayable</code> + recently terminal ones for late-payment detection) and asks: does this transfer satisfy a stored expectation? </li>
<li> <strong>Fuzzy matching stays in its lane.</strong> A transfer that matches no exact expectation can fuzzy-match <em>only within the same amount bucket</em> — the audit caught candidates leaking across buckets, which is how an ops person mis-assigns real money. </li>
</ul>

<h2>What did the adversarial audit break?</h2>

<p> We ran an external adversarial review of the engine before calling it done. Verdict: <strong>2 Critical + 9 High — all real, all fixed, all with regression tests.</strong> The two that matter most: </p>

<p> <strong>Paid-but-never-delivered was a silent terminal state (C-1).</strong> <code>dispatchFulfillment</code> wrote <code>done</code> after <em>any</em> handler return — including a handler that bailed early without minting. CONFIRMED money, zero delivery, and nothing would ever revisit it. The fix makes fulfillment outcomes honest: <code>FulfillmentOutcome</code> is a discriminated union (<code>executed | deduped-done | needs-ops | deduped</code>), <code>done</code> is written only for outcomes that <em>prove</em> the effect ran, and <code>needs-ops</code> files a CRITICAL <code>FULFILLMENT_UNRESOLVED</code> exception plus a durable marker the reconciliation sweep re-checks. </p>

<p> <strong>The chain scan trusted every decoded log (C-2).</strong> Hand-built <code>topics[]</code> plus a lenient decoder meant a Transfer emitted by a <em>different contract</em> — or to a <em>different recipient</em> — could decode as "our" payment. Now the scan uses viem's <code>getLogs({event: Transfer, args: {to: treasury}})</code> filter, and post-decode asserts <code>log.address === USDC</code> and <code>decoded.to === treasury</code>. </p>

<p> The Highs are the checklist you'd want anyway: </p>

<ul>
<li> <strong>No chainId assert</strong> — a misconfigured <code>ARC_RPC_URL</code> would scan the wrong chain forever; <code>verifyChainId</code> is now lazy-fetched, cached, and fatal on mismatch. </li>
<li> <strong>Second tx on a consumed attempt</strong> — previously ignored; now bound-hash + exact-match logic classifies it (<code>EXACT_TX_ON_UNCONFIRMED_ATTEMPT</code>, <code>EXTRA_TX_ON_CONSUMED_ATTEMPT</code>), and a different-hash confirmation dedupes to <code>DISPUTED</code>. </li>
<li> <strong>One malformed attempt killed the whole tick</strong> — now per-attempt isolation: bad expectation → <code>errors[]</code> entry, loop continues. </li>
<li> <strong>Self-serve exposed unmonitored rails</strong> — <code>PAYMENTS_USDC_SELF_SERVE</code> alone would emit instructions for networks the monitor doesn't watch; it now hard-fails without <code>USDC_MONITOR_ENABLED</code> + <code>ARC_RPC_URL</code> + an arc-labeled network, and filters <code>usdcNetworks</code> to Arc only. </li>
<li> <strong>Stale-claim reclaim raced</strong> — two workers could re-run the same effect; a deterministic <code>fulfill-reclaim-&lt;pay&gt;</code> CAS marker fences concurrent reclaimers. </li>
</ul>

<p><img src="/images/blog/arc-c48-direct-usdc-engine-exceptions.webp" alt="Floating ops-queue cards, each a payment exception with a severity chip — INFO gray, WARN amber, CRITICAL red — one CRITICAL card glowing at the front labeled paid but never delivered" /></p>
<p><em> Every anomaly has a name, a severity, and a deterministic ID. </em></p>

<h2>How do you know it's still consistent an hour later?</h2>

<p> You don't — unless someone checks. Once an hour, an env-gated reconciliation sweep diffs <strong>three sources of truth</strong>: attempt expectations, chain Transfer events, and stored receipts. Every disagreement has a name: </p>

<p><img src="/images/blog/arc-c48-direct-usdc-engine-recon.webp" alt="Three glass ledger panels — attempt expectations, chain transfers, receipts — feeding a diff engine whose mismatched rows funnel into an exceptions queue" /></p>

<p><img src="/images/blog/arc-c48-direct-usdc-engine-d2.webp" alt="Flowchart of the reconciliation: three sources of truth — attempt expectations, chain Transfers, receipts — feed reconcileTransfers, which emits seven mismatch kinds into the exception queue, WARN for strays and CRITICAL for gaps and drift" /></p>

<p> <code>CHAIN_TX_WITHOUT_ATTEMPT</code>, <code>CONFIRMED_WITHOUT_RECEIPT</code>, <code>RECEIPT_WITHOUT_CHAIN_TX</code>, <code>AMOUNT_DRIFT</code>, <code>RECIPIENT_DRIFT</code>, <code>CONFIRMED_WITHOUT_FULFILLMENT</code>, plus the two consumed-attempt kinds from the audit. Stray inbound transfers warn; gaps and drift escalate to CRITICAL. Each exception gets a deterministic ID (<code>exc-recon-{kind}-{key}</code>), so re-runs dedupe instead of spamming — and the cursor only advances after a fully successful pass, so a bad tick never silently skips blocks. </p>

<p> Refunds are deliberately boring: an admin posts the refund txHash to <code>POST /api/v1/payments/:id/refund</code>, the service opens a <code>REFUND_REQUEST</code> exception, calls <code>markRefunded</code> (strict guard: <code>CONFIRMED | DISPUTED</code> → <code>REFUNDED</code>, non-idempotent), and closes the exception. Humans move the money; the engine keeps the books. </p>

<h2>What's live and how do I try it?</h2>

<ul>
<li> <code>POST https://agentbadge.xyz/api/v1/payments/:id/attempts</code> — <code>{ "provider": "DIRECT_USDC", "network": "eip155:1874" }</code> returns instructions <code>{ amount, recipient, tokenContract, reference, expiresAt }</code>. </li>
<li> <code>GET https://agentbadge.xyz/api/v1/payments/:id</code> — status + attempts; <code>/receipt</code> once confirmed. </li>
<li> <code>GET https://agentbadge.xyz/api/v1/payments/exceptions</code> — the ops queue (admin auth). </li>
<li> <code>POST https://agentbadge.xyz/api/v1/payments/:id/refund</code> — manual refund (admin auth). </li>
</ul>

<p> The rail is opt-in and gated by honesty, not by flag gymnastics: <code>PAYMENTS_USDC_SELF_SERVE</code> won't emit instructions unless <code>USDC_MONITOR_ENABLED</code> + <code>ARC_RPC_URL</code> + an arc-labeled network are set — a server that can't watch the chain doesn't get to sell "pay us in USDC". </p>

<h2>What are the honest limits?</h2>

<ul>
<li> <strong>One chain.</strong> Arc only — Base and Solana are deferred, and self-serve actively filters non-Arc networks out of instructions. </li>
<li> <strong>In-process sweeper.</strong> Same pattern as our bounty-lease sweeper: no external infra, no queue workers. Deliberately small; the failure modes live in domain logic, not in plumbing. </li>
<li> <strong>One audit.</strong> An adversarial review we paid attention to, not a proof. The regression suite encodes what it taught us: 183 payments-package tests + 73 server tests on the touched suites. </li>
<li> <strong>Manual refunds.</strong> Money movement is a human-with-txHash operation; automation is a separate, scarier epic. </li>
</ul>

<p> The deeper principle is the one the audit kept proving: <strong>a chain payment isn't an event you receive, it's a claim you verify</strong> — against expectations you wrote down before the money arrived, with a paper trail for everything that doesn't add up. </p>

<hr />

<p><em> Stack: <code>@agentbadge/payments</code> (pure TS domain) + viem on Arc (<code>eip155:1874</code>), Bun + Hono server, deterministic-exception ops queue. All findings and fixes are documented in the internal review log; the regression tests are the artifact that outlives this article. </em></p>
`;
