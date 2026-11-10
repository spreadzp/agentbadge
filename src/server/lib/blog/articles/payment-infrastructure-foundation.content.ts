/**
 * SLICE-220-9 · EPIC-162 C45 — Payment Infrastructure Foundation (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c45-payment-foundation/AgentBadge-Blog.md
 */
export const paymentInfrastructureFoundationContent = `
<p> Every payment integration we've written or reviewed eventually grows the same knot: the business entity that means "this customer owes us $5" gets tangled with the adapter that talks to Stripe, or a blockchain, or a PSP. The rail's status enum leaks into your domain. Your "refund" code calls the rail before it records that a refund is happening. Your "confirmed" flag is whatever the rail said last. </p>
<p> The failure mode isn't hypothetical. It's the standard one: two state machines — yours and theirs — drifting apart, while your code pretends there's one. </p>
<p> <code>@agentbadge/payments</code> (EPIC-220) draws the boundary explicitly: </p>
<table>
  <thead>
    <tr><th>Entity</th><th>What it means</th><th>Owned by</th></tr>
  </thead>
  <tbody>
    <tr><td><code>Payment</code></td><td>The obligation: reference, amount, customer, status</td><td>domain</td></tr>
    <tr><td><code>PaymentAttempt</code></td><td>One try at settling it, on one provider+network</td><td>domain</td></tr>
    <tr><td><code>PaymentReceipt</code></td><td>Append-only proof that money moved, keyed to evidence</td><td>domain</td></tr>
    <tr><td><code>PaymentEvent</code></td><td>Append-only audit trail: from→to, actor, reason</td><td>domain</td></tr>
    <tr><td><code>PaymentEvidence</code></td><td>Normalized rail output: status, tx hash, amount, finality</td><td>adapter</td></tr>
  </tbody>
</table>
<p> The rail (<code>PaymentProvider</code> interface: <code>createPayment</code>, <code>verifyPayment</code>, optional <code>refundPayment</code>) produces <strong>evidence</strong>, never verdicts. Only the domain writes domain state. </p>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-hero.webp"
       alt="A rail carriage labeled RAIL hands an evidence envelope toward a glowing checkpoint bridge; above the gate a magnifier hovers over nine lit green checkmarks; on the far platform an emerald DOMAIN vault holds four stacked slots — Payment, Attempt, Receipt, Event — with an amber $5.00 capsule floating nearby" />
  <figcaption> The split, drawn: the rail produces evidence; the domain keeps verdicts — and nothing crosses the gate unchecked. </figcaption>
</figure>

<h2>Why separate the money layer from the money rail</h2>

<p> Wait — that table <em>is</em> the why. So let me put the argument differently: the split isn't an abstraction fetish, it's a failure-isolation decision. When the rail's enum becomes your domain's truth, every retry, every race, every provider quirk becomes a domain bug you can't see. Keeping evidence and verdict in different hands is what makes the rest of this article testable at all. </p>

<h2>Controlled transitions: two maps, no free-form UPDATEs</h2>

<p> Payment and Attempt each get a transition map. Every status change goes through a guarded <code>applyStatus(expectedFrom, to)</code> at the store level — a concurrent writer who moved the row first returns <code>null</code>, and the loser re-reads and reports what is actually persisted. </p>
<p> The payment machine (post-audit): </p>
<pre><code>PENDING ──→ PROCESSING ──→ CONFIRMED
    │           │  ├──────→ DISPUTED ──→ CONFIRMED / REFUNDED
    │           │  └──────→ FAILED / EXPIRED
    └──────────→ EXPIRED
FAILED, EXPIRED, REFUNDED, CONFIRMED = terminal</code></pre>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-2.webp"
       alt="The status machine as a conveyor: tokens move PENDING → PROCESSING → a nine-keyhole emerald checkpoint banner reads &quot;9 checks&quot; → CONFIRMED; side ramps drop tokens to FAILED (red seal, crossed-out return) and DISPUTED (amber warning, exits to CONFIRMED and REFUNDED); a sweeper clock feeds PENDING → EXPIRED" />
  <figcaption> The same machine as a conveyor: tokens reach CONFIRMED only through the nine-keyhole gate; DISPUTED has exactly two exits — CONFIRMED after review or REFUNDED. </figcaption>
</figure>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-d1.webp"
       alt="State diagram of the payment lifecycle as implemented: PENDING → PROCESSING → CONFIRMED only via confirmPayment's 9-check verdict; PROCESSING → DISPUTED on SUCCESS evidence + failed check; PROCESSING → FAILED/EXPIRED; CONFIRMED → DISPUTED as the refund claim; DISPUTED → REFUNDED on rail REFUNDED, DISPUTED → CONFIRMED on rollback. FAILED and EXPIRED are terminal" />
  <figcaption> The payment machine as it actually ships — every edge is a guarded write, and CONFIRMED has exactly one entrance. </figcaption>
</figure>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-d1b.webp"
       alt="The refund cycle as a state diagram: refundPayment claims CONFIRMED → DISPUTED before touching the rail; DISPUTED → REFUNDED on rail REFUNDED; DISPUTED → CONFIRMED on rail FAILED/UNSUPPORTED — the claim rolls back. A note summarizes the claim-first semantics and the re-confirm dedupe" />
  <figcaption> The claim-first refund, as a machine: <code>DISPUTED</code> doubles as the refund lock — rail PENDING holds it, rail FAILED rolls it back, rail REFUNDED settles it. </figcaption>
</figure>

<p> Two details earned their place in the map: </p>
<ul>
  <li> <strong><code>FAILED</code> is terminal.</strong> The audit found a <code>FAILED → PENDING</code> resurrection edge — a payment declared dead could quietly come back and hop to CONFIRMED with no attempt or receipt attached. Retry is now expressed as a new create, not a resurrection. </li>
  <li> <strong><code>DISPUTED</code> does double duty, deliberately.</strong> It's the review state for "rail says SUCCESS but our checks disagree" — captured funds that need a human — and it's the claim state for refunds: <code>CONFIRMED → DISPUTED</code> is taken <em>before</em> the rail refund call, so a concurrent second refund loses the claim instead of charging twice. </li>
</ul>

<h2>Verification: nine checks between evidence and CONFIRMED</h2>

<p> <code>verifyPayment()</code> in the service never trusts a rail status. It normalizes evidence and runs nine checks — reference, amount, currency, provider, recipient, network, finality, transaction-reuse, plus the rail's own terminal signal: </p>
<table>
  <thead>
    <tr><th>Check</th><th>Catches</th></tr>
  </thead>
  <tbody>
    <tr><td><code>reference_match</code></td><td>confirming the wrong payment entirely</td></tr>
    <tr><td><code>amount_match</code> / <code>currency_match</code></td><td>partial payments, cross-asset confusion</td></tr>
    <tr><td><code>provider_match</code></td><td>evidence from rail A applied to rail B's attempt</td></tr>
    <tr><td><code>recipient_match</code></td><td>money arrived at an attacker-controlled address</td></tr>
    <tr><td><code>network_match</code></td><td>same tx hash, wrong chain</td></tr>
    <tr><td><code>finality</code></td><td>tx exists but isn't confirmed enough</td></tr>
    <tr><td><code>tx_not_reused</code></td><td>one onchain tx confirming two payments</td></tr>
    <tr><td><code>status_success</code></td><td>evidence claiming success it can't back</td></tr>
  </tbody>
</table>
<p> A clean verdict is the <em>only</em> path to <code>CONFIRMED</code>. Not a rail callback. Not a create-time status. Not a raw <code>transitionPayment</code> — the audit noticed those helpers were exported from the package barrel, so we un-exported them; the only public doors are the guarded persistence paths and the service. </p>

<h2>What happens when evidence and checks disagree</h2>

<p> The subtle part: a failed check means different things depending on whether money moved. </p>
<ul>
  <li> <strong>Retryable-only failures</strong> (today: <code>finality</code>) → <code>PENDING</code>. The tx exists, it just isn't deep enough yet. Confirming this as FAILED would lose a good payment; confirming it as CONFIRMED would front-run consensus. </li>
  <li> <strong>Non-retryable failure on captured funds</strong> → payment <code>DISPUTED</code>. The money is there but something is wrong — wrong recipient, replayed tx, mismatched amount. Marking FAILED would lie (the funds exist); confirming would compound it. DISPUTED says "review me". </li>
  <li> <strong>Failed check + no captured funds</strong> → <code>FAILED</code> or <code>EXPIRED</code> per evidence. </li>
</ul>

<h2>Idempotency at two levels</h2>

<p> <strong>Level 1 — entity dedupe.</strong> <code>createPayment</code> looks up by <code>reference</code> then <code>idempotencyKey</code> before inserting. The audit's sharper point: the old code deduped on the key <em>only</em> — a caller reusing "ord-1" with a different amount silently got the first payment back. Now each row stores a JSON <strong>request fingerprint</strong> in <code>payment.payload.request</code>; a dedupe hit with a mismatched fingerprint returns <code>conflict</code>, not a silent swap. Rail metadata (checkout URL, session id) is persisted on the attempt and replayed on dedupe, so a lost first response doesn't lose the checkout link. </p>
<p> <strong>Level 2 — claim-first side effects.</strong> The refund path used to call the rail <em>then</em> try to update state. Two concurrent refunds = two rail charges. Now the service takes a guarded <code>CONFIRMED → DISPUTED</code> claim first, calls the rail with a deterministic idempotency key (<code>refund_&lt;paymentId&gt;_&lt;amount&gt;</code>), then resolves: <code>REFUNDED</code> on success, rollback to <code>CONFIRMED</code> on failure, claim held on <code>PENDING</code> for resume. </p>
<p> Same pattern in <code>confirmPayment</code>: the guarded write loses a race? Re-read and return the persisted status — never fabricate a CONFIRMED response. And if an attempt is CONFIRMED but the payment/receipt lagged (non-atomic triple write), the next confirm call self-heals: completes the payment transition and appends the missing receipt idempotently. </p>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-d2.webp"
       alt="Sequence diagram of confirmPayment and refundPayment end-to-end: Caller → PaymentService → Persistence (guarded) → Rail (provider). confirmPayment verifies the rail evidence, runs the 9-check pipeline and replay lookup, then takes the guarded CONFIRMED write and appends a receipt — a lost race re-reads and reports the persisted status. refundPayment validates, claims CONFIRMED → DISPUTED, calls the rail with a deterministic idempotency key, then resolves REFUNDED / held claim / rollback to CONFIRMED" />
  <figcaption> Both flows end-to-end: evidence in, verdict out — and the refund claims <code>CONFIRMED → DISPUTED</code> before it ever touches the rail. </figcaption>
</figure>

<h2>Decimal-string money</h2>

<p> Amounts are <code>"5.00"</code> strings everywhere in the domain — <code>assertDecimalAmount</code> guards format and scale, comparisons go through <code>decimalAmountsEqual</code>, and conversion to cents happens only at the adapter boundary (<code>usdToCents</code>/<code>centsToUsd</code> are BigInt-exact). The audit's M-4 sharpened this: zero amounts and &gt;15 integer digits are rejected at create, and an unparseable evidence amount now <em>fails</em> the amount check instead of throwing. </p>

<h2>The audit: 5 Critical, and what they taught us</h2>

<p> We pointed an adversarial reviewer (Arc Studio, external AI audit) at the package. Verdict: <strong>BLOCK — 5 Critical, 6 High, 11 Medium</strong>. The findings that made us glad we ran it before wiring this to money: </p>
<ul>
  <li> <strong>C-1</strong> — the create path drove the attempt to the rail-reported status, so a rail returning <code>CONFIRMED</code> at create skipped the entire verification pipeline. Now clamped to <code>PROCESSING</code>; CONFIRMED exists only behind the 9-check verdict. </li>
  <li> <strong>C-2</strong> — a lost guarded-write race returned <code>status: "CONFIRMED"</code> without checking what actually won. A sweeper expiring the attempt in the same tick would be silently overwritten by the response. </li>
  <li> <strong>C-3</strong> — attempt→payment→receipt were three separate writes; a crash between them left a CONFIRMED attempt on a PROCESSING payment forever. The self-healing completion path repairs it on the next read. </li>
  <li> <strong>C-4</strong> — refund called the rail before claiming state: the classic double-refund. </li>
  <li> <strong>C-5</strong> — <code>FakeProvider</code> defaulted to auto-confirm and echoed input back as evidence — a fail-open test rail that could be registered as a real provider. It now defaults to <code>"pending"</code> and carries an <code>isTestProvider</code> marker. </li>
</ul>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-3.webp"
       alt="A glass audit shield between a clipboard and a tiny checkpoint bridge; the clipboard reads BLOCK with five stamped findings — C-1 rail self-confirms, C-2 lost race lies, C-3 split writes, C-4 double refund, C-5 fake rail fail-open — each stamped FIXED in green, plus &quot;6 High&quot; also FIXED; a ribbon on the shield reads 112/112; a robot-agent mascot polishes the shield" />
  <figcaption> Round one of the adversarial audit: 5 Critical + 6 High stamped FIXED. (Rendered before round two — the suite is 114/114 now.) </figcaption>
</figure>

<p> The Highs were the same shape — places where the code <em>assumed</em> instead of <em>checking</em>: expiry that never asked the rail whether it was still alive, expectations re-supplied by the caller instead of persisted on the attempt, dedupe without fingerprints, raw transitions in the export surface. The full finding-by-finding resolution is in <code>docs/EPICS/220-payment-infrastructure-foundation/reviews/220-payments-REVIEW.md</code>. </p>

<h2>Then we ran it on real money (test mode)</h2>

<p> Unit tests are hypothesis; the rail is the experiment. We pointed the service at <strong>Stripe test mode</strong> (<code>sk_test_*</code>), generated a real Checkout Session, paid it with <code>4242…</code>, and let the full lifecycle run — create → dedupe edges → pay → confirm → receipt → refund → re-refund. </p>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-live-checkout.webp"
       alt="The live Stripe Checkout sandbox page for the dogfood run: &quot;EPIC-220 dogfood (test mode)&quot; line item, $1.00, dogfood@agentbadge.xyz prefilled" />
  <figcaption> The hosted Stripe Checkout sandbox page the script generated — real session, $1.00, dogfood inbox prefilled. </figcaption>
</figure>

<p> The first run <strong>caught a live bug the unit suite missed</strong>: we passed a <code>network</code> expectation on a fiat rail. Stripe evidence carries no network tag, so <code>network_match</code> failed on a fully paid session → the payment landed in <code>DISPUTED</code> with captured funds — and had no API way out (the refund path expected a CONFIRMED attempt the dispute never produced). We refunded it manually via the Stripe API and logged it as finding <code>220-10-F1</code>. This is exactly the class of failure the design was supposed to prevent — and the live rail found it in five minutes. </p>
<p> So we ran the adversarial audit <strong>again</strong>, this time against the live-verified code. Verdict: <strong>REQUEST CHANGES — 1 Critical, 6 High, 8 Medium</strong>. The second-round findings were nastier: the local expiry clock could bury a <em>paid-but-unconfirmed</em> session without ever asking the rail; caller input could override the expectations persisted at create (griefing on fiat, bypass on onchain); the refund claim key compared raw <code>"5.00"</code> vs <code>"5.0"</code> strings as different amounts; and a routine re-confirm could silently cancel an in-flight refund claim. </p>
<p> All of it got fixed and re-verified: the sweeper and lazy reads now consult the rail and defer on <em>any</em> uncertainty; providers declare which expectations they can satisfy and <code>createPayment</code> rejects the rest before a row exists; persisted expectations are authoritative; the refund path validates before claiming, canonicalizes the idempotency key, and rolls back on rail errors. </p>
<p> <strong>The proof run, on the same Stripe test-mode rail:</strong> </p>
<ul>
  <li> <code>edge-fiat-network-guard</code> → <code>guardRejected:true</code> — the 220-10-F1 bug is now unreachable, rejected at create. </li>
  <li> <code>CONFIRMED</code> → 1 receipt (external ref = Checkout Session, <code>transactionHash</code> = PaymentIntent <code>pi_3UZzR1K84Am2sMrt1Y6iuI1j</code>), re-confirm deduped with no second receipt. </li>
  <li> <code>refund</code> → <code>REFUNDED</code> (<code>re_3UZzR1K84Am2sMrt1uxL6SzD</code>); two <em>concurrent</em> refund calls both returned REFUNDED and the rail shows exactly <strong>one</strong> refund — <code>railRefundCount:1</code>. Exactly-once, measured on the rail, not asserted in a mock. </li>
</ul>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-live-success.webp"
       alt="The post-fix success page: &quot;Payment Successful!&quot;, $1.00, dogfood@agentbadge.xyz — the hardened run that reached CONFIRMED" />
  <figcaption> The post-fix run: payment settled, receipt written, status CONFIRMED — on <code>dogfood@agentbadge.xyz</code>, not a personal inbox. </figcaption>
</figure>

<figure class="article-image">
  <img src="/images/blog/payment-infrastructure-foundation-live-refund.webp"
       alt="The Stripe receipt after the refund — proof the REFUNDED transition hit the rail exactly once" />
  <figcaption> The refund on the rail's own receipt — <code>railRefundCount:1</code> made visible. </figcaption>
</figure>

<p> Transcripts and screenshots (test-mode ids, safe to publish) are in <code>docs/EPICS/220-payment-infrastructure-foundation/evidence/</code>; the finding-by-finding resolution is <code>reviews/220-payments-REAUDIT.md</code>. 114/114 tests green. </p>

<h2>Honest scope</h2>

<p> What exists: the domain model, both state machines, the verification pipeline, guarded persistence ports (Map-backed in-memory + <code>@agentbadge/database</code> Prisma), the <code>PaymentService</code> facade, the expiry sweeper, <code>FakeProvider</code>, <code>StripePaymentProvider</code> (Checkout Sessions, evidence mapping, refunds with idempotency keys). </p>
<p> What does <strong>not</strong> exist yet: </p>
<ul>
  <li> <strong>USDC / x402 rails</strong> — the provider interface is ready for them; the adapters are the next epics. </li>
  <li> <strong>HTTP routes / webhook ingestion</strong> — the service is a library; the commerce epics on top will expose it. </li>
  <li> <strong>Live checkout migration</strong> — the existing Stripe checkout path is untouched (D-220-1); this is the foundation underneath, not a swap. </li>
  <li> <strong>Refund ledger</strong> — partial-refund accounting is a deferred follow-up (M-6 tail). </li>
  <li> <strong>DB-level transition enforcement</strong> — the maps are enforced at the persistence layer in app code; a CHECK/trigger in <code>@agentbadge/database</code> is the belt-and-suspenders follow-up. </li>
</ul>

<h2>What's next</h2>

<p> The foundation earns its keep when a second rail lands: USDC/x402 adapters, the payments-commerce epics (hosted checkout, webhook ingestion, agent-facing create/confirm flows), and refund accounting. The thesis we'll keep testing: <em>the rail reports evidence; the domain decides truth — and nothing reaches CONFIRMED that didn't survive all nine checks.</em> </p>

<p class="series-note"> Series: this is the payment-foundation writeup behind the agent commerce stack. Previously: <a href="/blog/economic-ledger">Economic Ledger</a> (where money events land), <a href="/blog/arc-c32-payment-forensics">Payment Forensics</a> (reading the graph it produces), <a href="/blog/keyless-signer">Keyless Signer</a> (who signs onchain). Live at <a href="https://agentbadge.xyz">agentbadge.xyz</a> — source and specs on <a href="https://github.com/spreadzp/agentbadge">GitHub</a>. </p>
`;
