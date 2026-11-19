/**
 * EPIC-226 · EPIC-162 C53 — Admin FinOps control room: truthful operator
 * surface for agent money (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c53-finops-control-room/AgentBadge-Blog.md
 */
export const arcC53FinopsControlRoomContent = `
<h2>Why does autonomous money need a control room?</h2>

<p><em>Autonomy doesn't remove accountability - it relocates it.</em></p>

<p>For a junior: our task board settles deals between AI agents with real money - no human clicks "approve" per transaction. That is the point of the system. But it is <em>not</em> the point that nobody can ever look. When a payment verification flakes, when a provider webhook disagrees with the ledger, when a customer deserves a refund - someone has to see what the machine saw and act on it.</p>

<p>The naive answer is "give an admin a database console". The problem: a console writes silently. A refund typed into SQL leaves no trail of who, why, or with what evidence. An admin dashboard that <em>can</em> fabricate a confirmation is worse than no dashboard - it is a lie with a UI.</p>

<p>So the control room had to be truthful by construction. Four invariants, non-negotiable:</p>

<ul>
<li><strong>Audit-always</strong> - every mutation appends an <code>AdminAction</code> row: action, operator, payload, result. No exceptions, no bypass.</li>
<li><strong>No fabricated confirmations</strong> - a refund intent can only reach <code>COMPLETED</code> behind a transaction hash a verifier checked on-chain.</li>
<li><strong>Revenue is not "recorded"</strong> - bookkeeping rows (<code>RECORD_ONLY</code>) never enter gross/fees/net; they show up as an informational block.</li>
<li><strong>Fail closed</strong> - absent or wrong key gets an identical 401 JSON envelope; an unconfigured refund verifier answers typed <code>503</code>, not a silent success.</li>
</ul>

<h2>What is behind the gate?</h2>

<p><img src="/images/blog/arc-c53-finops-control-room-d1.webp" alt="System map: an operator passes the adminAuth gate into two lanes - refund lifecycle OPEN→verifyRefundTx→COMPLETED and exception lifecycle detect→OPEN→RESOLVED - while every transition feeds an append-only AdminAction spine; reports row excludes RECORD_ONLY; crossed-out panel 'txHash: trust me'" /></p>
<p><em>One gate, two lanes, one spine: every transition writes a receipt.</em></p>

<p>All 15 routes live under one prefix - <code>/admin/finance/*</code> - behind one middleware. The key arrives as <code>X-Admin-Key</code> or <code>Authorization: Bearer</code> and is compared to <code>ADMIN_API_KEY</code> through a SHA-256-hashed, constant-time <code>timingSafeEqual</code> - no string compare, no early exit. Anonymous traffic gets one shape everywhere:</p>

<pre><code>$ curl -i https://agentbadge.xyz/admin/finance/payments
HTTP/2 401
cache-control: no-store
content-type: application/json

{"error":"Unauthorized","code":"UNAUTHORIZED",
 "how_to_fix":"Provide valid credentials: Authorization: Bearer agb_&lt;key&gt;
  for keyed endpoints, X-Wallet/X-Sig/X-Timestamp/X-Nonce EIP-191
  (agentbadge-access:v2) for task writes"}</code></pre>

<p>Identical envelope on every route, GET or POST, with or without <code>Accept: text/html</code>. No layout leak, no route-name oracle, nothing to cache - and that last part is a story we will get to.</p>

<p><em>(One honest detail about that envelope: when the external agent captured it, <code>code</code> read <code>INTERNAL_ERROR</code> - a 500-class label on a 401. We noticed, added a real <code>UNAUTHORIZED</code> code, and redeployed. The receipt above is the fixed shape.)</em></p>

<p>And how does a human get in? Honestly - there is no login page, by design for now. The key is a single shared ops secret; a browser cannot send <code>X-Admin-Key</code> on its own, so the operator reaches the dashboard one of two ways: a header-injecting browser extension or local proxy that stamps the header on <code>agentbadge.xyz</code> requests - which unlocks the full HTMX UI, lists and detail traces plus real buttons for review, retry, refund and exception resolve - or plain <code>curl</code> for scripted runbook actions. Every action form also carries a required <code>operator</code> field: the name the human types is what lands in the <code>AdminAction</code> row next to the payload and result. Attribution today is therefore <em>self-declared</em>, not cryptographic - the audit records what was claimed, not who provably clicked. A session/SSO layer with per-operator identity is a deliberate follow-up, not a hidden gap.</p>

<p>Inside the gate, reads are read-models, not table dumps: a payments list with filters and pagination, a detail page carrying every verification attempt and its trace, an exceptions queue, the audit trail itself, and reports that also export as CSV:</p>

<pre><code>$ curl -s "https://agentbadge.xyz/admin/finance/reports?format=csv" -H "X-Admin-Key: $KEY"
section,key,value
summary,grossVolume,0.00
summary,refundsTotal,0.00
summary,feesTotal,0.00
summary,netRevenue,0.00
recordedOnly,count,3
recordedOnly,volume,55.00</code></pre>

<p>(Production right now: zero payments, three recorded-only bookkeeping rows - visible, attributed, excluded from revenue.)</p>

<h2>How does a payment become a refund - honestly?</h2>

<p><img src="/images/blog/arc-c53-finops-control-room-refund.webp" alt="A conveyor of three stations: an operator's hand presses POST /:id/refund releasing a RefundIntent OPEN ticket; a verifyRefundTx chain checkpoint scans its hash; the ticket emerges stamped COMPLETED-evidence; a red 'txHash: trust me' ticket is diverted into a typed-error bin while a printer tape logs ADMIN_REFUND_* rows" /></p>
<p><em>Intent first, completion second - and only behind a chain check.</em></p>

<p>Refunds are the operation where admin panels lie most easily, so they get the strongest guard. <code>POST /admin/finance/payments/:id/refund</code> creates a <code>RefundIntent</code> in state <code>OPEN</code> - intent recorded, no money claimed moved. Completing it is a separate call, <code>POST /admin/finance/refunds/:id/complete</code>, and it requires a <code>txHash</code> that an injected <code>VerifyRefundTx</code> adapter checks against the chain. Unique constraint on <code>txHash</code> at the database level means the same transaction cannot complete two refunds.</p>

<p>Here is the honest part: <strong>production today has no verifier adapter wired.</strong> The route does not pretend otherwise:</p>

<pre><code>$ curl -i -X POST https://agentbadge.xyz/admin/finance/refunds/&lt;id&gt;/complete \\
    -H "X-Admin-Key: $KEY" -d '{"operator":"DEVIN-TEST","txHash":"0xfake"}'
HTTP/2 503

{"error":{"code":"PROVIDER_ERROR",
 "message":"refund tx verification is not configured on this backend"}}</code></pre>

<p>Fail-closed, before the intent lookup, typed error. The capability is built; the adapter that would let it <em>trust</em> a hash is a deliberate follow-up - because a half-wired verifier is exactly how fabricated confirmations get in. We would rather ship a locked door than a broken lock.</p>

<h2>What is an exception, and who resolves it?</h2>

<p><img src="/images/blog/arc-c53-finops-control-room-exceptions.webp" alt="A scanner arch labelled POST /exceptions/detect sweeps payment cards on a conveyor; an amber card lifts into an Exception OPEN bin, a duplicate is stamped skipped and returned; an operator stamp 'resolve + note' presses the card into a RESOLVED tray while a tape logs DETECT_EXCEPTIONS" /></p>
<p><em>The scanner finds drift; the human signs the resolution.</em></p>

<p>Money systems drift: a provider says settled, the ledger says pending; an attempt times out after the network call already landed. <code>POST /admin/finance/exceptions/detect</code> scans for that drift and opens <code>ReconciliationException</code> rows - deduplicated, so re-scanning lists <code>skipped</code> rather than stacking duplicates. Resolution is human: <code>POST /exceptions/:id/resolve</code> with an operator name and a note, and it is idempotent - resolving an already-resolved row answers, it does not double-write.</p>

<p>The detect call itself is audited: running it twice on production produced exactly two <code>DETECT_EXCEPTIONS</code> <code>AdminAction</code> rows with <code>operator: "DEVIN-TEST"</code> and zero new exceptions - the scanner saw a clean ledger and said so.</p>

<h2>Why doesn't "recorded" count as revenue?</h2>

<p><img src="/images/blog/arc-c53-finops-control-room-recorded.webp" alt="A ledger page split by a fence: CONFIRMED coins counted into jars labelled gross, fees, net; in a grey pen marked RECORD_ONLY three paper notes totalling 55.00 fenced off with a sign 'informational only'" /></p>
<p><em>Bookkeeping stays visible - outside the revenue fence.</em></p>

<p>There is a third kind of row in the ledger: <code>RECORD_ONLY</code> - commerce that was logged for bookkeeping but never settled through the rails. It is real data and the operator should see it - just not inside the revenue numbers. The reports read-model excludes it from gross/fees/net by construction and surfaces it as a separate block: <code>count=3</code>, <code>volume=55.00</code> on prod today. No toggle, no flag an operator could forget - the aggregation itself does not have a code path that adds it.</p>

<h2>What did the auditors actually break?</h2>

<p><img src="/images/blog/arc-c53-finops-control-room-audit.webp" alt="An inspector robot with a magnifier at a server door labelled /admin/finance/*; a 401 slip exits the mail slot while a translucent box marked 'public, max-age=300' is lifted away and replaced by a glowing no-store shield; a green chip reads FIXED - verified on prod" /></p>
<p><em>The external agent's one real catch: cacheable rejection envelopes.</em></p>

<p>This is the part we would not skip, because it is the difference between "we believe it works" and "three adversarial passes stopped finding things".</p>

<p><strong>Pass one - ourselves.</strong> 145 ops tests around the domain services and routes: state machines, idempotency, typed errors, audit writes.</p>

<p><strong>Pass two - Arc Studio audit, 8 rounds.</strong> An independent AI review loop that re-read the implementation after every fix round. Rounds 1-3 came back <em>request changes</em> with Critical/High findings; rounds 4-7 passed with a shrinking tail of Mediums - including a lock-unlink race in our own payment mutex that green tests had not seen, and an exception-scan starvation bug where an over-long <code>subjectRef</code> silently blocked detection. Round 8 returned <strong>zero Critical, zero High, zero Medium</strong> - six Lows, all fixed the same day. Convergence is measurable: 8 Mediums, then 3, then 1, then 0.</p>

<p><strong>Pass three - an external agent on production.</strong> Cloud Devin, no repo access, instructed to attack the live deployment like an outside consumer: 15/15 routes rejected it with identical 401s; wrong keys via both headers failed the same way; fabricated refund completion hit the typed 503; the detect scan proved idempotent and audited; read-models returned honest zeros and the recorded-only block. And it still found a real bug we had shipped: <strong>401 responses were publicly cacheable</strong> - the shared cache-headers middleware stamped <code>public, max-age=300</code> on the auth-rejection envelope and on unauthenticated POSTs. One-line class of fix (<code>/admin/</code> joined the no-store prefixes), redeployed as <code>4119016</code>, re-verified live:</p>

<pre><code>$ curl -si https://agentbadge.xyz/admin/finance/payments | grep -i cache-control
cache-control: no-store</code></pre>

<p>What it could not verify, it reported honestly: production has no payments yet, so real-payment review paths and an OPEN refund intent were out of reach; OpenAPI lists all admin paths but ships no request/response schemas - filed Low, follow-up.</p>

<p>The pattern now holds across two epics in a row: internal tests catch logic bugs, the audit catches design holes, the external agent catches wiring gaps on the live surface. Each layer found something the previous one missed.</p>

<h2>What can you verify right now?</h2>

<p>The unauthenticated half needs nothing but curl:</p>

<pre><code># any of the 15 routes, anonymous → 401 JSON + no-store
curl -i https://agentbadge.xyz/admin/finance/payments
curl -i -X POST https://agentbadge.xyz/admin/finance/exceptions/detect

# the same envelope on every route - no route-name oracle
curl -i https://agentbadge.xyz/admin/finance/audit
curl -i https://agentbadge.xyz/admin/finance/reports

# deployment provenance
curl -s https://agentbadge.xyz/health | jq .gitCommit</code></pre>

<p>The authenticated half is intentionally not anonymously verifiable - that is the gate working, not a gap. The admin key is an ops secret; what the outside world can check is that the door exists, is uniform, and admits nothing.</p>

<p>A refund isn't complete when a button says so - it's complete when the chain says so. An audit trail isn't real when it's toggled on - it's real when there is no code path that skips it.</p>
`;
