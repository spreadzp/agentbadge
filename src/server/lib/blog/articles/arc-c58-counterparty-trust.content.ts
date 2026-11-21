/**
 * EPIC-257 · C58 — x402 counterparty trust: vet402 gate before signing,
 * fulfillment journal after settlement (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c58-counterparty-trust/AgentBadge-Blog.md
 */
export const arcC58CounterpartyTrustContent = `
<p><em>This is part of the Arc campaign series. Previous episode: <a
href="/blog/arc-c57-peach-dex">we let an agent swap EURC for USDC into its own
budget vault</a> (EPIC-254 - crash-safe DEX funding). This article is
EPIC-257: counterparty trust for x402 payments.</em></p>
<h2
id="the-problem-an-x402-payment-is-a-coin-flip-you-cannot-take-back">The
problem: an x402 payment is a coin flip you cannot take back</h2>
<p><em>For a junior: x402 is the protocol where an API answers your request
with <code>402 Payment Required</code> - “pay this much crypto to this
address, come back with a receipt, and I’ll give you the answer.” Our
agent does this dozens of times a day.</em></p>
<p>Here is the uncomfortable part. Everything in that flow is
<strong>self-reported by the seller</strong>: the price, the address,
the asset. Until now our agent read the challenge and paid it, no
questions asked. That is three separate risks wearing one coat:</p>
<ul>
<li><strong>Is this seller real?</strong> Anyone can host a 402
endpoint, collect a payment, and return garbage or nothing. Crypto has
no chargeback.</li>
<li><strong>Is this the same deal as before?</strong> A seller that was
honest last week can answer today’s challenge with a different address
or a 10x price. Checking “reputation by URL” does not catch a swapped
destination account.</li>
<li><strong>What happened after we paid?</strong> On the seller side,
settlement proves the money moved - it says nothing about whether the
content was actually delivered. That fact existed nowhere.</li>
</ul>
<h2 id="the-measurer-not-the-judge">The measurer, not the judge</h2>
<p><a href="https://vet402.com">vet402</a> is an independent service
that does one thing: it buys from catalog-listed x402 endpoints itself,
records what happened, and serves those measurements over a keyless
public API. No keys, no accounts, no “trust us.”</p>
<p>Important distinction, because it shapes everything downstream:
vet402 is a <strong>measurer</strong>, not a judge. It reports a verdict
(ALLOW / WARN / BLOCK) plus the <em>terms it actually paid and
verified</em> - the real <code>payTo</code>, asset, amount, network,
scheme. What we <em>do</em> with those facts is our own policy decision.
Their job is evidence. Our job is the consequence.</p>
<h2 id="loop-one-check-before-you-pay">Loop one: check before you
pay</h2>
<figure>
<img src="/images/blog/arc-c58-counterparty-trust-i2.webp"
alt="The check pipeline - sanitize drops the API key into a redacted bin, the robot reads the vet402 catalog, a decision gauge points at WARN, a terms-match arm compares two quotes, and a policy traffic light sorts the deal into pay, hold or deny chutes" />
<figcaption aria-hidden="true">The check pipeline - sanitize drops the
API key into a redacted bin, the robot reads the vet402 catalog, a
decision gauge points at WARN, a terms-match arm compares two quotes,
and a policy traffic light sorts the deal into pay, hold or deny
chutes</figcaption>
</figure>
<p>The gate sits in <code>buyPay</code> after the envelope checks and
before the CLI spawn - meaning before <em>signing</em>, where refusing
costs nothing:</p>
<ol type="1">
<li><strong>Sanitize first.</strong> Before a single byte goes to
vet402, the resource URL is scrubbed: query strings, fragments, embedded
credentials, and secret-looking path segments are all refused locally. A
URL carrying <code>?api_key=...</code> produces zero outbound calls and
parks itself for the owner. Nothing secret ever leaves.</li>
<li><strong>Resolve and decide.</strong> The client asks vet402 for the
endpoint’s resource id, then for the payer-side decision. Caches,
singleflight (ten parallel checks on one URL produce one outbound call),
a per-process rate limiter, and hard timeout budgets - because this sits
in a payment path.</li>
<li><strong>Compare the deal, not the vibes.</strong> We take the
<em>actual <code>accepts[]</code> offer the CLI will sign</em> and
compare it field-by-field against the terms vet402 verified - exact
equality in v1. Different <code>payTo</code>: denied. Higher amount:
denied. <em>Lower</em> amount: also denied - a substituted deal is a
substituted deal.</li>
<li><strong>Apply the matrix.</strong> Verdict × terms-match → four
outcomes: <code>allow</code> (pay now), <code>hold</code> (park for the
owner), <code>deny</code> (refuse), <code>unavailable</code> (vet402
unreachable - a retryable preflight, never a reason to guess).</li>
</ol>
<p>The matrix is deliberately fail-closed. A BLOCK verdict beats every
combination of terms state - even when vet402 reports its own data as
degraded. An unknown seller is not a silent pass; it is a hold, and a
human decides.</p>
<h2 id="approvals-are-bound-to-the-exact-deal">Approvals are bound to
the exact deal</h2>
<p>Here is the part I would have gotten wrong. A WARN parks an approval
request for the owner. Naively, that approval is “the owner allowed a
payment from this wallet” - which an attacker (or a drifting seller)
could redeem against <em>any</em> offer.</p>
<p>Ours is fingerprint-bound: the approval carries
<code>sha256:v1</code> over (wallet, url, the exact offer). When the
owner approves and the payment retries, the permit is consumed
<strong>atomically</strong> only if this quote’s fingerprint re-derives
to the same value. Approved deal A, deal becomes B: the consume refuses
<em>without</em> consuming anything. Two parallel payments racing the
same permit: exactly one wins - the transition is a single-use atomic
<code>approved → consumed</code>, enforced all the way down to a
Postgres partial unique index on
<code>(wallet, fingerprint, pending)</code>.</p>
<p>And because money is involved, one more rule:
<code>unavailable</code> is a <em>preflight</em> answer. It can be
retried - as a fresh check. What is never retried through this machinery
is money movement itself. Once the permit is consumed and the payment
CLI dies mid-flight, the record says <code>uncertain</code> - humans
reconcile, code does not re-sign.</p>
<figure>
<img src="/images/blog/arc-c58-counterparty-trust-i3.webp"
alt="The approval lock - a padlock keyed by a sha256:v1 fingerprint over wallet, url and offer. A robot stamps APPROVED on the matching quote; a sneaky robot holding a DIFFERENT QUOTE gets REFUSED without consuming the permit. A TTL hourglass sits on the lock" />
<figcaption aria-hidden="true">The approval lock - a padlock keyed by a
sha256:v1 fingerprint over wallet, url and offer. A robot stamps
APPROVED on the matching quote; a sneaky robot holding a DIFFERENT QUOTE
gets REFUSED without consuming the permit. A TTL hourglass sits on the
lock</figcaption>
</figure>
<h2 id="loop-two-our-own-journal-of-what-happened-next">Loop two: our
own journal of what happened next</h2>
<figure>
<img src="/images/blog/arc-c58-counterparty-trust-d2.webp"
alt="The fulfillment pipeline - settle issues a tx id, a usage record pins it as the requestId, the paid handler runs, an honest classifier picks completed, error, aborted or unknown, and an idempotent x402_fulfillment event lands in the journal" />
<figcaption aria-hidden="true">The fulfillment pipeline - settle issues
a tx id, a usage record pins it as the requestId, the paid handler runs,
an honest classifier picks completed, error, aborted or unknown, and an
idempotent x402_fulfillment event lands in the journal</figcaption>
</figure>
<p>vet402 can never see the second contour: what <strong>our</strong>
handlers did with <strong>our</strong> paid requests. So we keep the
fact ourselves - an <code>x402_fulfillment</code> event appended to the
economic ledger after the paid handler returns, keyed
<code>ev:x402:{usageRecordId}~fulfill:1</code> so replays
deduplicate.</p>
<p>The honest part is the outcome vocabulary. The event records what we
<em>observed</em>, nothing more:</p>
<ul>
<li><code>handler_completed</code> - the handler returned a fully
materialized 2xx</li>
<li><code>upstream_error</code> - a 5xx or a thrown handler</li>
<li><code>stream_aborted</code> - only on a real client-abort
signal</li>
<li><code>unknown</code> - anything without a reliable completion
signal. A streaming response (SSE, chunked) whose headers say 200 is
<code>unknown</code>, not <code>handler_completed</code> - headers going
out is not proof the stream delivered. <code>unknown</code> is never
quietly upgraded to success.</li>
</ul>
<p>Two properties worth calling out. The event is deliberately
<strong>not</strong> a trust edge: it carries no counterparty and no
amount, so it cannot leak into exposure aggregation or revenue math - it
is evidence, not a vote. And emission is truly fire-and-forget: if the
ledger write fails, the paid response is still 200, the complete
serialized event lands in the warn log,
<code>x402_fulfillment_emit_failed_total</code> ticks up, and a replay
script re-appends the record verbatim - deduplicated by the same
idempotency key.</p>
<h2 id="how-we-rolled-it-out">How we rolled it out</h2>
<p><code>COUNTERPARTY_CHECK_MODE=off | shadow | enforce</code>. Shadow
mode evaluates and logs every decision - the same decision enforce would
apply - but lets the payment through: that is the canary for a rollout
that wants one. We went straight to enforce - the matrix had already
been exercised end-to-end, and fail-closed is the honest default for
code that gates money. Dev and test still default to off so unrelated
suites never depend on the network.</p>
<p>What production showed on day one — enforce mode, real traffic:</p>
<ul>
<li>An unknown seller was held <strong>before signing</strong>: the CLI
reported <code>not_in_catalog → unmeasured → hold</code> and exited
without producing a signature. No catalog listing means friction, not a
silent pass - exactly what the matrix says.</li>
<li>A real $0.02 USDC payment settled on Arc mainnet through the
GatewayWalletBatched rail (tx <code>8f3a3d9d-…</code>), the handler
returned 200, and the ledger gained exactly one
<code>x402_fulfillment</code> row: <code>handler_completed</code>,
httpStatus 200, anchored to the settlement id as its requestId. Zero
trust edges were created from it; revenue totals
(<code>kind='pay'</code>) are untouched.</li>
</ul>
<figure>
<img src="/images/blog/arc-c58-counterparty-trust-shot-hold.webp"
alt="Real production run - the CLI parked an unlisted seller at HOLD and exited before a signature existed" />
<figcaption aria-hidden="true">Real production run - the CLI parked an
unlisted seller at HOLD and exited before a signature
existed</figcaption>
</figure>
<figure>
<img src="/images/blog/arc-c58-counterparty-trust-shot-settle.webp"
alt="Production settle log - $0.02 USDC on Arc mainnet via the GatewayWalletBatched rail" />
<figcaption aria-hidden="true">Production settle log - $0.02 USDC on Arc
mainnet via the GatewayWalletBatched rail</figcaption>
</figure>
<figure>
<img src="/images/blog/arc-c58-counterparty-trust-shot-fulfillment.webp"
alt="The fulfillment row in the production ledger - handler_completed/200 anchored to the settlement id, zero trust edges" />
<figcaption aria-hidden="true">The fulfillment row in the production
ledger - handler_completed/200 anchored to the settlement id, zero trust
edges</figcaption>
</figure>
<h2 id="externally-reviewed">Externally reviewed</h2>
<p>Arc Studio audited the counterparty path before ship. Verdict:
<strong>request changes</strong> - 2 criticals, 8 highs, 10 mediums. The
criticals were real, and both were the kind of bug a green test suite
will never show you:</p>
<ul>
<li><strong>“Signed ≠ vetted.”</strong> The CLI picked <em>which</em>
<code>accepts[]</code> entry to sign after the terms check - so it could
pay a different deal than the one that was vetted. Now the whole
selected offer is bound into the fingerprint.</li>
<li><strong>Approval lifecycle races.</strong> Parked approvals could
livelock, and a consume that wasn’t atomic across processes let two
payments redeem one permit. Now park/commit is explicit and the
<code>approved → consumed</code> transition is atomic all the way down
to a Postgres partial unique index.</li>
</ul>
<p>The highs were the same genre: the URL sanitizer missed
capability-URL forms (privacy boundary), a “refused” classification that
could auto-retry after signature (money-path taxonomy), and a
stream-detector that quietly upgraded streamed 200s to
<code>handler_completed</code> (fulfillment honesty). All criticals,
highs and mediums landed across seven remediation slices; what remains
is documented nits. The audit did its job - it found the holes our own
review was blind to.</p>
<figure>
<img src="/images/blog/arc-c58-counterparty-trust-i4.webp"
alt="The remediation corridor - an auditor holds a red REQUEST CHANGES card while a crew of robots fixes the numbered doors 257-13 through 257-19: signed-not-equal-vetted badges, atomic latches, a privacy shredder eating an API key, and an unknown-outcome stamp" />
<figcaption aria-hidden="true">The remediation corridor - an auditor
holds a red REQUEST CHANGES card while a crew of robots fixes the
numbered doors 257-13 through 257-19: signed-not-equal-vetted badges,
atomic latches, a privacy shredder eating an API key, and an
unknown-outcome stamp</figcaption>
</figure>
<h2 id="the-honest-limits">The honest limits</h2>
<ul>
<li>vet402 only measures endpoints in the public catalogs it syncs (CDP
Bazaar, Circle discovery, MPP directory). If a seller is not listed,
there is no assessment to read - the answer is a hold, not a pass.
Visibility is earned through the catalogs, not applied for.</li>
<li>Terms matching is exact in v1. A seller quoting a <em>lower</em>
price than verified still mismatches - deliberate: any substitution is a
new deal that deserves a new look.</li>
<li>Fulfillment evidence is advisory in v1. It does not auto-block
sellers and it does not gate settlement - it builds the record those
future decisions can stand on.</li>
</ul>
<h2 id="what-is-verified-today">What is verified today</h2>
<p>25 end-to-end tests run the full buyer path against a real
<code>Vet402Client</code> pointed at a hermetic mock vet402 server -
every row of the acceptance matrix: exact-offer pay, payTo/amount
substitution denials, multi-offer selection,
WARN→hold→approve→consume→pay, parallel holds deduplicating to one
approval, fingerprint-mismatch consumes refusing, timeout/429/500 →
retryable unavailable, cache and singleflight outbound counts,
secret-URL zero-outbound, and the two-payments-one-fingerprint race
ending in exactly one consume. On the seller side: 5xx records
<code>upstream_error</code>, SSE streams record <code>unknown</code>,
and a failed ledger append still returns 200 with the full replayable
event in the log. 46 buy-domain tests, 47 gateway tests, 169 package
counterparty/buyer tests, 33 policy-matrix cells, 124 schema tests, 72
approval-backend tests underneath it all.</p>
<p>What is <em>not</em> here: a replay drill against a synthetic ledger
failure on production (the warn-log/replay machinery is tested locally),
and the WARN→hold→approve→pay dance with a real external seller - the
one case production has not produced yet, because our first real seller
was not in vet402’s catalog at all.</p>
<hr />
<p><em>C58 in the Arc Campaign series. Built on Arc: mainnet <code>5042</code> live - real USDC, real settlement id, real fulfillment rows.</em></p>
<p><strong>Read the arc:</strong></p>
<ul>
<li><a href="/blog/arc-c57-peach-dex">EURC&rarr;USDC funding into the budget vault</a> (C57, EPIC-254) - the crash-safe journal on the funding side; this article is the same discipline on the paying side.</li>
<li><a href="/blog/arc-c52-agent-trust-layers">Agent trust layers</a> (C52) - the layered-trust model this counterparty check plugs into.</li>
<li><a href="/blog/arc-c55-a2a-settlement">The A2A settlement layer</a> (C55, EPIC-227) - when agents pay agents; counterparty trust is the missing piece this adds.</li>
<li><a href="/blog/arc-c51-agent-commerce">Agent commerce</a> (C51, EPIC-224) - the deal machines whose payouts this gate now precedes.</li>
<li><a href="/blog/arc-c50-x402-gateway">The x402 payment gateway</a> (C50) - the rail these checks ride on.</li>
</ul>
`;
