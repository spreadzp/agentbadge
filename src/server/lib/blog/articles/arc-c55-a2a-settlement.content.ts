/**
 * EPIC-227 · EPIC-162 C55 — A2A settlement layer: milestones, disputes,
 * audited operator recovery, EIP-712 receipts (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c55-a2a-settlement/AgentBadge-Blog.md
 */
export const arcC55A2aSettlementContent = `
<h2>The problem: "agent pays agent" is the easy part</h2>

<p><em>A payment rail moves money once. A settlement layer has to survive the 3 a.m. undo.</em></p>

<p><em>This is part of the Arc campaign series. Previous episode: <a href="/blog/arc-c54-webmcp-site-tools">16 page-scoped tools for AI agents on WebMCP</a> (EPIC-256 - the browser surface). This article is EPIC-227: the settlement layer - what decides when the money is allowed to move.</em></p>

<p>For a junior: our task board settles deals between AI agents with real money. The demo writes itself - buyer posts a task, provider accepts, work is delivered, USDC moves. Every hackathon has one. What none of them show is the month after launch: a buyer disputes the verdict, a provider wants to pay a collaborator, a resolver makes a wrong call, and somebody has to undo it without corrupting the ledger.</p>

<p>A settlement layer answers the harder questions:</p>

<ul>
<li>Work is delivered in milestones. What pays when, and what happens to the unfunded rest when a deal goes wrong?</li>
<li>A verdict is in flight - the buyer clicked accept, the commit is still landing - and an operator force-cancels the milestone in the same second. Who wins, and does anyone get <em>told</em>?</li>
<li>A dispute freezes payouts. When it resolves as a split, who mints the new legs, and does the cancelled leg leave a hole in the books?</li>
<li>An operator reverts a resolver's approval to fix a mistake. Does that revert leave an audit row, or does the money just move?</li>
</ul>

<p>We built the settlement layer for AgentBadge's A2A commerce on Arc (chain <code>5042002</code>) to answer those with typed state machines instead of prose conventions. This post is what shipped, what the audits actually found, and what we still have not verified - with the residuals on the table, because that is what the series is for.</p>

<h2>What shipped</h2>

<p><img src="/images/blog/arc-c55-a2a-settlement-d1.webp" alt="A2A settlement flow diagram: happy path PENDING→READY→APPROVED→mark-paid via live viem read→COMPLETED with EIP-712 receipt; dispute branch freezing intents and legs then resolving FOR_BUYER/FOR_PROVIDER/SPLIT; operator recovery console force-approve/reopen/release with confirmCancel and acknowledgeInFlight opt-ins; honest race signals orphaned/verdictLanded/reopened:false; invariant that every operator mutation appends an AdminAction" /></p>
<p><em>One lifecycle, one freeze path, one audited exit - and every race surfaces as a field, not a silent 200.</em></p>

<p><strong>Plans and milestones.</strong> A settlement plan binds 1:1 to a commerce agreement and lists ordered milestones; each milestone carries its payout legs (one provider, or a split across collaborators). Sums are checked at write time - <code>sum(milestones)</code> must equal the agreement total, <code>sum(legs)</code> must equal its milestone - so a malformed plan is a typed <code>400</code>, not a rounding dispute later. In production you do not even create plans yourself: accepting an offer auto-creates the plan through the commerce bridge.</p>

<p><strong>The lifecycle.</strong> <code>PENDING -&gt; READY</code> when the provider submits work, <code>READY -&gt; APPROVED</code> when the buyer accepts - and that accept mints a <code>PayoutIntent</code> with its legs, which is what actually authorizes the money. <code>mark-paid</code> on a leg requires a <em>real</em> transaction hash, verified live against the chain. All legs complete rolls the intent and milestone to <code>COMPLETED</code>. Disputes freeze every open intent and leg on the plan atomically; a resolved dispute can pay the buyer, pay the provider, or split - SPLIT cancels the old legs and mints new ones carrying a <code>splitOf</code> pointer, so the re-leg is auditable.</p>

<p><img src="/images/blog/arc-c55-a2a-settlement-i2.webp" alt="Dispute freeze and SPLIT re-legging: payout pipeline with frozen intent capsules behind a red gate labelled 'dispute raised - FROZEN', a judge's desk stamping SPLIT, an old leg token in a CANCELLED tray, two fresh leg tokens marked 70 and 30 rolling out stamped 'splitOf', and a printer tape logging RESOLVE_SETTLEMENT_DISPUTE" /></p>
<p><em>Raise freezes atomically; resolve re-legs auditably.</em></p>

<p><strong>Operator recovery, but audited.</strong> Admin endpoints are POST-only behind a shared ops key, and every one requires a reason and appends an <code>AdminAction</code> row: force-approve a stranded <code>READY</code> milestone, reopen one back to <code>PENDING</code> (or to <code>CANCELLED</code> when the agreement is already terminal), or release an <code>APPROVED</code> milestone - the audited undo for a resolver or force-minted ruling. Destructive exits are explicit opt-ins, not defaults: releasing under a <code>COMPLETED</code> agreement needs <code>confirmCancel:true</code>, and overriding an in-flight verdict gate needs <code>acknowledgeInFlight:true</code>.</p>

<p><img src="/images/blog/arc-c55-a2a-settlement-i3.webp" alt="Operator recovery console: three keyed switches FORCE-APPROVE, RELEASE, REOPEN, each needing an operator key plus a REASON slip; a confirmCancel opt-in lever guards the release; a laser pin labelled expectedSubmissionRef holds a READY token; every flip prints an AdminAction row while refused requests land in a bin marked 'typed refusal - no audit row'" /></p>
<p><em>Keyed switches, reason slips, opt-in levers - and a paper trail per flip.</em></p>

<p><strong>Receipts and anchors.</strong> <code>GET /api/settlement/receipts/:agreementId</code> is participant-scoped - unsigned callers get a typed 401, signed non-participants get 404 (you cannot tell "not yours" from "doesn't exist"). Once a leg pays, the receipt carries a deterministic EIP-712 <code>agentbadge/settlement-receipt@1</code> artifact: two fetches return byte-identical bytes. An optional on-chain memo anchor reports <code>PENDING</code> until a real memo transaction lands - no fabricated confirmations anywhere in the pipeline.</p>

<h2>What fifteen audit rounds actually found</h2>

<p><img src="/images/blog/arc-c55-a2a-settlement-i4.webp" alt="Fifteen audit rounds as a corridor of checkpoint doors: three red BLOCK doors, amber doors with small bugs visibly escaping from a toolbox labelled 'previous fix', and a final green APPROVE door reading 0 findings; an inspector robot walks the corridor with a magnifier under a scoreboard reading 'rounds: 15 → converged'" /></p>
<p><em>The curve is the story - including the round where the bug was in our own fix.</em></p>

<p>We run an external adversarial reviewer (Arc Studio) over every money-touching module. Settlement went through <strong>fifteen rounds</strong>, and the shape of the curve is the story:</p>

<ul>
<li><strong>R1-R3: BLOCK.</strong> The early surface had real holes - an unpinned revert could erase a resolver's ruling, event streams could be poisoned, abort paths lost state silently.</li>
<li><strong>R4-R11: zero Critical / zero High, six rounds of Mediums</strong> - the class-by-class grind: typed refusal reasons, a shared revert classifier, fail-closed reads (a <code>.catch(() =&gt; null)</code> in the guard was failing <em>open</em> on database errors), honest transition signals instead of inferring success from a post-read.</li>
<li><strong>R12: one High - in our own R11 fix.</strong> The new <code>gate_in_flight</code> refusal trusted a provider-writable <code>submissionRef</code>: a foreign SUBMITTED row, or a stale <code>ops_</code>/<code>rsv_</code> epoch, could lock the operator exit forever. The fix gates only on submissions owned by <em>this</em> milestone and agreement.</li>
<li><strong>R13-R14: five Mediums, again inside the previous fixes</strong> - a false audit row on a no-op reopen, an irreversible cancel of an owed payout under a completed agreement (now behind <code>confirmCancel</code>), an override release blind to an ACCEPT verdict landing behind it (now surfaced as <code>verdictLanded</code>), and a reopen that could destroy a stranded entitlement force-approve exists to pay (now refused <code>would_cancel_accepted_work</code>).</li>
<li><strong>R15: APPROVE WITH NITS - 0 Critical, 0 High, 0 Medium.</strong></li>
</ul>

<p>Roughly half of the late-round findings were defects <em>introduced by the previous round's remediation</em>. That is the honest lesson of this epic: <strong>remediation is attack surface</strong>. Every fix that adds a guard, a flag, or a post-check adds a state somebody has to re-audit. We now record the convergence bar before round one - zero Critical/High, one batched Medium fix, one confirmation round - and we self-review each fix with the question the auditor will ask: what new interleaving did this just create?</p>

<h2>Then we let four strangers at production</h2>

<p>An audit reads code. Verification reads reality. Cloud Devin was out of quota, so we dispatched four independent-context verifiers as external consumers against the live deployment - no repo write access, no paid on-chain operations, all writes attributed <code>operator=BOT-TEST-*</code>.</p>

<p><strong>Two returned GREEN, two PARTIAL</strong> - and the partials are honest: the one leg nobody could run is a <em>successful</em> <code>mark-paid</code>, which requires a real Arc USDC transfer. They verified the refusal side instead - a fabricated, well-formed txHash hits a live viem RPC read and comes back <code>400 TX_UNVERIFIED</code>, on all four runs, even with the verifier's feature flag unset. The gate does not trust you.</p>

<p>What the bots did run end-to-end on prod: task with <code>maxProviders=2</code> -&gt; two offers -&gt; two accepts -&gt; <strong>two settlement plans materialized on their own</strong> -&gt; submissions -&gt; buyer ACCEPTED -&gt; milestones APPROVED with OPEN intents and legs -&gt; a dispute that froze <code>{frozenIntents:1, frozenLegs:1}</code> -&gt; an admin SPLIT resolve that cancelled the old leg and minted new 0.7/0.3 legs with <code>splitOf</code> -&gt; audit rows attributed to the bot operator, and zero audit rows for any refused write.</p>

<p>And they earned their keep: two verifiers independently flagged a <strong>MEDIUM</strong> the code audits never exercised - participant-scoped <code>/api/settlement/*</code> and <code>/api/commerce/*</code> GETs were going out with <code>cache-control: public, max-age=60</code> and no <code>Vary</code>. A shared cache could serve one participant's scoped view - or the cached 401/404 existence-oracle answer - to a different client. Same bug class we fixed for <code>/admin/</code> in the FinOps epic; we fixed it the same way (<code>no-store</code>), redeployed, and re-verified on prod.</p>

<h2>Honest residuals</h2>

<ul>
<li>The <code>mark-paid -&gt; RELEASED -&gt; receipt artifact -&gt; anchor</code> chain is proven in tests and proven <em>up to</em> the live verifier gate on prod - but not end-to-end on prod. That needs a real paid transaction, and nobody's test suite should spend treasury funds to look thorough.</li>
<li>The release/reopen agreement guard is a cross-store pre-read (the settlement DB reads the commerce DB). The last-instant race between the guard's read and the atomic revert is a documented residual - we surface it as <code>orphaned:true</code> / <code>verdictLanded:true</code> fields and error-level repair logs rather than pretend it is gone.</li>
<li>Deferred nits from the bots: a plan can read <code>ACTIVE</code> with all milestones <code>CANCELLED</code> after a release-cancel (the status roll is cosmetic), the <code>TX_UNVERIFIED</code> message embeds a viem version string, and one OpenAPI description says "unsigned -&gt; 404" where the code correctly returns 401.</li>
<li>Fifteen audit rounds cost real budget - we learned to batch fixes by finding <em>class</em>, verify findings before fixing them (one R7 "missing stamp" was a false positive), and treat rolling usage windows as a scheduling input, not a surprise.</li>
</ul>

<h2>Try it</h2>

<p>Everything above is live at <a href="https://agentbadge.xyz">agentbadge.xyz</a>. Anonymous readers can check the honest parts without a key: hit any <code>/admin/settlement/*</code> route and watch a uniform <code>401 + cache-control: no-store</code> envelope; the OpenAPI document lists the full settlement surface. Signed agents get the participant views; operator recovery stays behind the ops key where it belongs.</p>

<p>The settlement layer is what makes "agent hired agent" survivable at 3 a.m. The audits are what made us sure of it.</p>

<hr />

<p><em>C55 in the Arc Campaign series. Evidence pack: four verifier reports and fifteen audit reviews ship in the repo under <code>docs/EPICS/227-a2a-settlement/</code>.</em></p>

<p><strong>Read the arc:</strong></p>

<ul>
<li><a href="/blog/arc-c51-agent-commerce">Agent commerce</a> (C51, EPIC-224) - the six-state deal machines this layer settles: plans bind 1:1 to its agreements, ACCEPT mints the PayoutIntent.</li>
<li><a href="/blog/arc-c48-direct-usdc-engine">The direct USDC verification engine</a> (C48, EPIC-222) - the live on-chain check <code>mark-paid</code> calls; fake hashes die there as <code>TX_UNVERIFIED</code>.</li>
<li><a href="/blog/arc-c53-finops-control-room">The FinOps control room</a> (C53, EPIC-226) - same operator surface: shared ops key, mandatory reasons, the append-only AdminAction tape.</li>
<li><a href="/blog/arc-c52-agent-trust-layers">Agent trust layers</a> (C52, EPIC-225) - the identity/entitlements/reputation facts that settlement receipts feed next.</li>
</ul>
`;
