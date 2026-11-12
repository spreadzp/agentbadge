/**
 * SLICE-221-8 · EPIC-162 C46 — Checkout 2.0 on Arc (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c46-checkout-two/AgentBadge-Blog.md
 */
export const arcC46CheckoutTwoContent = `
<p> Every checkout we've audited — ours included — has the same scar tissue: a form posts to a legacy endpoint, a Stripe session appears, a webhook fires, and somewhere between "paid" and "fulfilled" a product falls out of a hat. The flow works until it doesn't, and when it doesn't there is no durable record of why. </p>

<p> This EPIC rebuilt the whole path. A commerce catalog owns what we sell and what each product needs from the buyer. A payments API — sitting on the <a href="/blog/payment-infrastructure-foundation">EPIC-220 domain layer</a> — turns an order into <code>Payment → PaymentAttempt → instructions → status → PaymentReceipt</code>. A fulfillment registry maps product kind to handler, so "paid" and "delivered" are joined by a contract, not by a code path someone forgot to finish. Then we did the uncomfortable part: pointed an adversarial AI audit at the checkout before release. It came back <strong>BLOCK</strong> — 3 Critical, 9 High, 8 Medium. All twenty findings are now root-cause fixed with regression tests. </p>

<figure class="article-image">
  <img src="/images/blog/arc-c46-checkout-two-hero.webp"
       alt="The AgentBadge pricing page showing four passport tiers — Bronze $9.99, Silver $49.99, Gold $199.99, Platinum $499.99 — each with a Card (Stripe) or USDC selector, copy reading 'passports mint on Arc mainnet'" />
  <figcaption> The storefront the catalog renders: four tiers, two rails, Arc mainnet where the passports live. </figcaption>
</figure>

<h2>What the checkout actually is now</h2>

<p> The flow is catalog-driven, and the catalog is boring on purpose. Each product declares a USD price, a fulfillment kind, and a <strong>metadata schema</strong> — the fields the fulfillment handler needs. For passport tiers: <code>accountId</code> (the EVM wallet the passport mints to), <code>name</code>, <code>capabilities</code>, and optional <code>endpoint</code>/<code>skills</code>/<code>imageUrl</code>. Undeclared keys are rejected. Strings are length-bounded, arrays are item-bounded, and the validator runs <em>before</em> any payment row exists — bad metadata can no longer buy a broken fulfillment. </p>

<p> One API path serves both rails: </p>

<pre><code>POST /api/v1/payments          → { payment, deduped }
POST /api/v1/payments/:id/attempts
  { provider: "STRIPE" }       → redirectUrl → Stripe Checkout
  { provider: "DIRECT_USDC",
    network: "eip155:1874" }   → instructions: amount, recipient,
                                  tokenContract, reference, expiresAt
GET  /api/v1/payments/:id      → status + attempts
GET  /api/v1/payments/:id/receipt → receipt, once confirmed</code></pre>


<figure class="article-image">
  <img src="/images/blog/arc-c46-checkout-two-d1.webp"
       alt="Sequence diagram of one API serving two rails: buyer picks a tier on /pricing and fills catalog-declared fields on /checkout; POST /api/v1/payments returns the payment with Idempotency-Key dedupe; the STRIPE attempt returns a redirectUrl to Stripe Checkout and the webhook confirms by binding session.id to the stored PaymentAttempt; the DIRECT_USDC attempt on eip155:1874 returns instructions — unique amount 9.990044, recipient, tokenContract, reference, expiresAt; both rails converge on confirm → dispatchFulfillment → mint passport on Arc, with the fulfillment-done marker written after the handler returns" />
  <figcaption> One endpoint, two rails — and both end in the same durable fulfillment path. </figcaption>
</figure>

<p> The buyer picks a tier on <code>/pricing</code>, lands on <code>/checkout</code>, fills the fields the catalog declared, and chooses Card or USDC. Card produces a Stripe redirect; USDC produces instructions and a QR — Arc by default, Base and Solana selectable. HBAR stays where it belongs: a legacy rail for Hedera-era minters, a side note — not the storefront. </p>

<figure class="article-image">
  <img src="/images/blog/arc-c46-checkout-two-pricing.webp"
       alt="The pricing page storefront the buyer starts from: four tiers with USD as the primary price and HBAR noted only as a legacy Hedera rail" />
  <figcaption> The storefront: USD primary, Card or USDC — HBAR kept only as the legacy footnote. </figcaption>
</figure>

<figure class="article-image">
  <img src="/images/blog/arc-c46-checkout-two-form.webp"
       alt="The checkout form for a Bronze passport: catalog-declared fields — EVM wallet address (accountId), name, capabilities — with Card (Stripe) and USDC (Arc) payment method selector" />
  <figcaption> The form renders exactly what the catalog declared — wallet address, name, capabilities — plus the rail choice. </figcaption>
</figure>


<figure class="article-image">
  <img src="/images/blog/arc-c46-checkout-two-live-instructions.webp"
       alt="Live checkout instructions: QR code, amount 9.990044 USDC, network eip155:1874, recipient 0xcdd2…869d, token contract 0x036C…CF7e, reference pay_412f32ed…, expires timestamp — 'Send USDC to complete payment'" />
  <figcaption> Live dogfood: a real <code>DIRECT_USDC</code> attempt on <code>eip155:1874</code> — Arc mainnet. Note the amount: <strong>9.990044</strong>, not 9.99. More on that suffix below. </figcaption>
</figure>

<h2>The audit that blocked it</h2>

<p> We ran Arc Studio's adversarial review on the implementation before shipping (SLICE-221-6). Verdict: <strong>BLOCK</strong>. The findings were not stylistic: </p>

<table>
  <thead>
    <tr><th>Finding</th><th>Severity</th><th>What it would have done</th></tr>
  </thead>
  <tbody>
    <tr><td>Fulfillment marked done before the handler ran</td><td>Critical</td><td>A handler that throws or times out still leaves the order "fulfilled" — paid, undelivered, invisible</td></tr>
    <tr><td>In-memory dedupe only</td><td>Critical</td><td>Any restart or second instance re-fulfills the same payment — double mints, double entitlements</td></tr>
    <tr><td>Unescaped product code in the checkout 404</td><td>Critical</td><td>Reflected XSS: <code>/checkout?product=&lt;script&gt;</code> rendered verbatim</td></tr>
    <tr><td>Webhook trusted session metadata without binding to a stored attempt</td><td>High</td><td>Any session claiming <code>paymentId</code> could trigger confirmation</td></tr>
    <tr><td>Legacy metadata passed through to Stripe unfiltered</td><td>High</td><td>Client could overwrite server-owned fields — including <code>paymentId</code></td></tr>
    <tr><td>Idempotency-Key replayed request fields unchecked</td><td>High</td><td>Same key, different product → silently reuses the old payment</td></tr>
    <tr><td>Prototype-chain network lookup</td><td>High</td><td><code>network: "constructor"</code> and friends could resolve attacker-controlled shapes</td></tr>
    <tr><td>Metadata accepted into payment row, validated later</td><td>High</td><td>Garbage-in payment rows, failure discovered at fulfillment</td></tr>
    <tr><td>USDC instructions rail always on</td><td>High</td><td>An unmonitored self-serve rail exposed in production by default</td></tr>
    <tr><td>All USDC payments quoted the same amount</td><td>High</td><td>Ten buyers pay $9.99 → ten identical transfers; matching by tx is guesswork</td></tr>
  </tbody>
</table>

<figure class="article-image">
  <img src="/images/blog/arc-c46-checkout-two-audit.webp"
       alt="Illustration of the audit outcome: a BLOCK clipboard — Critical findings (fulfilled before handler, in-memory dedupe, 404 XSS), High and Medium columns — every item stamped FIXED beside a magnifier showing 17 tests" />
  <figcaption> All twenty findings stamped FIXED — 17 regression tests stand guard over the Critical and High list. </figcaption>
</figure>


<h2>The fixes — root cause, not patches</h2>

<p> <strong>Order of operations (C-1).</strong> <code>dispatchFulfillment</code> now reports an explicit status — <code>fulfilled</code>, <code>deduped</code>, or <code>no-handler</code> — and the completion marker is written <em>after</em> the handler returns. A thrown handler produces a <code>failed</code> event and a 5xx that lets the rail retry, instead of a silent "done". </p>

<p> <strong>Durable dedupe (C-2).</strong> In-memory flags survived one process. Fulfillment now claims through the event store: a <code>fulfillment-claim</code> event keyed by payment, a <code>fulfillment-done</code> event on success. Fresh claims dedupe; claims older than ten minutes are treated as stale and retried — a crashed worker no longer locks the order forever. </p>

<figure class="article-image">
  <img src="/images/blog/arc-c46-checkout-two-d2.webp"
       alt="State diagram of durable fulfillment dedupe: a fulfillment-claim event keyed by paymentId enters CLAIMED; a handler that returns writes fulfillment-done AFTER it returns (C-1); a fresh claim that sees an existing done or claim resolves deduped; a thrown handler produces a failed event and 5xx so the rail retries; claims older than ten minutes are stale and retry — an event-store claim, not an in-memory flag, so restarts and second instances still dedupe (C-2)" />
  <figcaption> The dedupe machine, exactly as it ships: claims live in the event store, so a restart can't unlock a double mint. </figcaption>
</figure>


<p> <strong>Binding, not trust (H-1/H-2).</strong> The Stripe webhook now resolves <code>session.id → PaymentAttempt</code> through the attempt store, verifies the session's payment status and amount against our own record, and only then confirms. Legacy checkout metadata is whitelisted — server-owned keys (<code>paymentId</code>, <code>productId</code>, <code>productCode</code>, <code>tier</code>) can no longer be injected by the client. Provider error details no longer leak into client responses. </p>

<p> <strong>Idempotency with a fingerprint (H-3).</strong> Replaying an <code>Idempotency-Key</code> returns the original payment — but only if the request fingerprint matches. Same key, different product or metadata → <code>409 idempotency_conflict</code>. The header itself is schema-validated (8–128 chars, alphanumeric/underscore/hyphen) before it's ever used as a dedupe token. </p>

<p> <strong>Schema-first metadata (H-5).</strong> Validation moved upstream: <code>validateProductMetadata</code> runs before the payment row is created. The schema rejects undeclared fields, enforces per-field types and length limits, and projects only declared keys — <code>sanitizeProductMetadata</code> can't leak fields the product didn't ask for. </p>

<p> <strong>Rails that earn their way on (H-8).</strong> The direct-USDC instructions stub ships behind <code>PAYMENTS_USDC_SELF_SERVE</code> — off by default, opt-in when the monitoring story exists. An unmonitored rail should never be the default. </p>

<p> <strong>Unique-amount dedupe (H-9).</strong> The one visible in the screenshot: USDC instructions carry a deterministic micro-unit suffix derived from the payment ID — $9.99 becomes <code>9.990044</code>. Ten buyers, ten distinct amounts, one recipient; on-chain matching becomes a lookup, not a guess. Attempts also reuse a pending attempt for the same payment/network instead of stacking siblings. </p>

<figure class="article-image">
  <img src="/images/blog/arc-c46-checkout-two-dedupe.webp"
       alt="Two-panel illustration: left, an event-store ledger with fulfillment-claim and fulfillment-done entries, a 10-minute dedupe clock; right, the unique-amount funnel — USDC transfers with distinct micro-unit suffixes match payments exactly" />
  <figcaption> Two fixes in one picture: the event-store claim that survives restarts, and the unique amount that turns matching into a lookup. </figcaption>
</figure>


<p> Full disclosure in the review artifact: <code>docs/EPICS/221-pricing-checkout-2/reviews/checkout-REVIEW.md</code> — every finding with its fix and regression test mapped. </p>

<h2>Soft migration, not a flag day</h2>

<p> The legacy <code>/payment</code> and <code>/checkout</code> endpoints still work — they now answer with <code>Deprecation</code>, <code>Sunset</code>, and <code>Link</code> headers pointing at <code>/api/v1/payments</code>, and a migration guide (<code>docs/payments-v1-migration.md</code>) maps payloads field by field. Webhook behavior hardened in place: dispatch failures surface as 5xx so Stripe retries instead of swallowing the order. </p>

<h2>Receipts, not vibes</h2>

<p> The dogfood run behind the screenshots: <code>POST /api/v1/payments</code> (Bronze tier, catalog metadata) → <code>DIRECT_USDC</code> attempt on <code>eip155:1874</code> → instructions with the unique amount, Arc USDC contract, recipient treasury, reference, one-hour TTL → <code>GET /api/v1/payments/:id</code> polling PROCESSING. Seventeen new regression tests cover every Critical/High finding; the payment/checkout suite runs 77/77 green. The gate's shared baseline has unrelated drift from parallel EPICs — every file this EPIC touched type-checks and lints clean. </p>

<p> What we'd tell past us: the audit found what "it works in my manual test" never would — race windows, trust boundaries, and the XSS hiding in a 404. Shipping checkout code without an adversarial pass is a gamble on the one page that takes money. </p>
`;
