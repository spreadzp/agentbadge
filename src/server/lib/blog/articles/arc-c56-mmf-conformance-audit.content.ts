/**
 * EPIC-255 · arc C56 — MMF conformance audit: Mandata's 92-vector
 * corpus run against the production x402 spend gate — 35 PASS, 7 BUG,
 * 33 MODEL, 15 NOT_MAPPABLE — published divergences, spec-author
 * rulings, and the v0.5-clamp proposal the run spawned (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c56-mmf-conformance-audit/AgentBadge-Blog.md
 */
export const arcC56MmfConformanceAuditContent = `
<h2>Why run somebody else's test suite at all?</h2>

<p><em>For a junior: a "mandate" is the rulebook an AI agent carries when it spends money - how much per transaction, how much per day, who it may pay, how fast it may act. Mandata's MMF - <a href="https://www.linkedin.com/in/shedrack-chiedozie-aji-437239177/">Shedrack Aji</a>'s <a href="https://github.com/ashedrack/mandata">open-source spec and Python reference gate</a>, published alongside a <a href="https://doi.org/10.13140/rg.2.2.29395.34083">peer preprint</a> - is one concrete proposal for that rulebook, with a twist we like: a published conformance corpus - 92 JSON vectors where each says "given this mandate and this request, the gate must answer allow or deny, and here is why."</em></p>

<p><em>This is part of the Arc campaign series. Previous episode: <a href="/blog/arc-c61-feedback-review">your users' complaints are now an agent's training data - feedback infrastructure live</a> (EPIC-230). This article is EPIC-255: conformance as an audit, not a badge.</em></p>

<p><em>Because a spec you didn't write is the only test that can surprise you.</em></p>

<p>Our own gate grew differently: a velocity window, per-tx and daily caps, suspended wallets, a deny ledger. It works - but every test it had ever faced was written by us. A corpus written by somebody who never saw our code is a different kind of mirror.</p>

<p>The rule we set before running anything, agreed with Shedrack:</p>

<p><strong><em>We test the implementation we actually have, not the implementation we wish we had.</em></strong></p>

<p>No production edits to make vectors pass. No emulating MMF semantics in the harness. Where our model lacks the construct a vector exercises, the vector gets classified - not faked.</p>

<p>Two more ground rules came from Shedrack before the first run: pin the corpus to a tagged release (<code>v0.4.24</code>), not <code>main</code> - so every delta is attributable to a fixed corpus version - and track the findings in a shared issue on the Mandata repo, where the comparison note would naturally start. Both became load-bearing decisions.</p>

<h2>The machinery: scalar projection, not translation</h2>

<p>MMF speaks <code>max_amount</code>, <code>total_budget</code>, <code>velocity_limit</code>, <code>prior_txns</code>, <code>tx.at</code>. Our gate speaks <code>perTxUsd</code>, <code>dailyUsd</code>, <code>maxTxPerHour</code>, seeded ledger entries, fake timers. The adapter projects MMF fields onto our knobs - and every projection carries an <strong>equivalence grade</strong> that is part of the result:</p>

<ul>
<li><strong>Exact</strong> - same semantics (<code>max_amount</code> &rarr; <code>perTxUsd</code> in cents)</li>
<li><strong>Partial</strong> - mechanism exists, semantics differ (MMF velocity window is 86 400 s; ours is 3 600 s)</li>
<li><strong>None</strong> - no counterpart (claim handshake, <code>tx_id</code> dedup, expiry)</li>
</ul>

<p>Verdicts land in one of six statuses: <code>PASS</code>, <code>DIVERGENCE-BUG</code> (our code violates its own contract), <code>DIVERGENCE-MODEL</code> (intentional design difference), <code>NOT_MAPPABLE</code> (dimension doesn't exist), <code>GATE_EXCEPTION</code> (enforcement threw - denied, no record), <code>HARNESS_ERROR</code> (our adapter broke, not the gate).</p>

<p>Every vector runs the real request pipeline - wallet resolution, registry lookup, enforcer, ledger - through actual Hono contexts on fresh stores. 43 vitest cases regenerate <code>results/*.json</code>, which we commit as the reference. Determinism is a requirement, not a hope: two runs must produce byte-identical output.</p>

<p><img src="/images/blog/arc-c56-mmf-conformance-audit-i2.webp" alt="A conveyor of sha256-sealed vector cards feeding a factory floor labelled production code, a magnifier stamping each output PASS, MODEL or BUG beside a grey rejected pile" /></p>
<p><em>The corpus drives production code. The harness only observes and classifies - it never reimplements the spec it is measuring.</em></p>

<h2>The scoreboard - four numbers, not one</h2>

<p><img src="/images/blog/arc-c56-mmf-conformance-audit-d1.webp" alt="A four-row scoreboard: spend-decision 36, delegation 18, lifecycle 29, crypto 9 - each with its own status mix" /></p>
<p><em>Different tracks measure different contracts. Merging them would hide the interesting parts.</em></p>

<table>
  <thead>
    <tr><th>Track</th><th>n</th><th>PASS</th><th>BUG</th><th>MODEL</th><th>NOT_MAPPABLE</th><th>GATE_EX</th></tr>
  </thead>
  <tbody>
    <tr><td>spend-decision</td><td>36</td><td>20</td><td>5</td><td>3</td><td>7</td><td>1</td></tr>
    <tr><td>delegation</td><td>18</td><td>4</td><td>0</td><td>13</td><td>1</td><td>0</td></tr>
    <tr><td>lifecycle</td><td>29</td><td>2</td><td>2</td><td>17</td><td>7</td><td>1</td></tr>
    <tr><td>crypto/evidence</td><td>9</td><td>9*</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>
  </tbody>
</table>

<p>* the honest asterisk: those 9 PASS mean our <em>test-side</em> &sect;5.6/&sect;7 canonicalizer and Ed25519 signer reproduce Mandata's pinned bytes exactly - good news for interop. Our production auth is EIP-191 wallet signatures; MMF's credential model and evidence hash chain do not exist on our side. We record that as equivalence <code>None</code>, not as conformance.</p>

<h2>Seven bugs the corpus caught (and one it inspired)</h2>

<p>This is the part most conformance posts skip. Ours didn't.</p>

<ol>
<li><strong>Unsafe amounts create live reservations</strong> - <code>0</code>, negative, string-typed and <code>-0</code> amounts all reserve successfully. Nothing validates amount sanity before the ledger write. (V04, V17, V29, V33 - 4 of the 5 spend BUGs.)</li>
</ol>

<p><img src="/images/blog/arc-c56-mmf-conformance-audit-shot-result.webp" alt="Result row for V04: expected allowed=false check=NON_POSITIVE; actual allowed=true amount=0 - mapped_to null on the validation dimension" /></p>
<p><em>One row of the committed JSON - V04, a $0 spend that reserves successfully.</em></p>

<ol start="2">
<li><strong>Malformed input reaches the gate and passes</strong> - a <code>payee</code> containing a lone UTF-16 surrogate parses fine, and the spend is <em>allowed</em>. The spec requires rejecting malformed input before evaluation - and the spec author confirmed that "we don't have a validation stage" is not an exemption, it is exactly the gap the vector exists to catch. V36 was reclassified MODEL &rarr; BUG after his review - this is why the audit went to the author before the article.</li>
<li><strong>Velocity evasion via void</strong> - our rate counter counts live <code>reserved|settled</code> entries; <code>released</code> drops out. An authorize&rarr;void&rarr;authorize loop walks straight through the tx-per-hour limit. MMF counts <em>issued</em> authorizations - the safer semantics. (L05, L09.)</li>
<li><strong>Check-then-insert race</strong> - a synchronized probe parked 8 parallel <code>begin()</code>s between the cap check and the insert: all 8 reserved, $160 against a $100 cap. Then we ran it naive - 32 concurrent calls on the <em>in-memory</em> backend: $320. The comment in <code>envelope.ts</code> claiming synchronous backends can't interleave between awaits is empirically false.</li>
<li><strong>Corrupted ledger = open gate + data loss</strong> - a malformed <code>ledger.json</code> parses to "empty", caps see zero usage, the spend is allowed&hellip; and the next insert silently overwrites the file. Fail-open and history destruction in one path.</li>
<li><strong>Denied with no trace</strong> - registry-failure and unregistered-wallet denies return errors but write no ledger entry, emit no alert. Invisible denials are un-auditable denials.</li>
<li><strong>Retries double-charge caps</strong> - all seven call sites that reach the gate use static or random <code>refId</code>s; none are dedup keys. A retried request is a second spend, by design of nobody.</li>
</ol>

<p><img src="/images/blog/arc-c56-mmf-conformance-audit-i3.webp" alt="Three panels: a zero-dollar coin printing a reservation ticket, an agent voiding and re-inserting a ticket while the rate dial stays still, and parallel coins all passing a checkpoint before any lands" /></p>
<p><em>Three of the bug classes, drawn. The fourth lives in a comment that turned out to be false.</em></p>

<p>All seven are filed into EPIC-234 (hardening) with priority order - the corpus found them, the corpus doesn't fix them.</p>

<h2>The model differences we stand behind</h2>

<p>33 vectors diverge because our gate deliberately isn't MMF-shaped:</p>

<ul>
<li><strong>No stored decisions.</strong> MMF emits <code>REPLAY</code> / <code>TX_CONFLICT</code> because it remembers verdicts. We re-reserve - a repeat <code>tx</code> is a new reservation. That is the single biggest divergence class and the most instructive one: it turns a spec question (should replay be idempotent?) into a product question (should a retried debit be free?).</li>
<li><strong>No claim/dispatch slot.</strong> MMF interposes <code>CLAIMED</code> between reserve and settle; we settle directly from reserved. Eight lifecycle vectors are un-runnable for lack of the state - reported as <code>NOT_MAPPABLE</code>, not skipped.</li>
<li><strong>Delegate clamps, not rejects.</strong> Delegate spend clamps to the owner cap where MMF expects <code>invalid</code>. Open question for Shedrack: is the verdict load-bearing, or is enforcing the effective bound enough?</li>
<li><strong>Coarser revocation.</strong> <code>mandate.revoked</code> maps to wallet-level <code>suspended</code> - Partial. We suspend the wallet, not one mandate.</li>
</ul>

<h2>What the run did to the spec</h2>

<p>The divergence table didn't just describe Mandata - it changed it.</p>

<p>We sent Shedrack <a href="https://github.com/ashedrack/mandata/issues/32">eight spec questions alongside the delta findings</a> before this post went anywhere: where a classification could legitimately move, his ruling was the tiebreaker. Most held. One moved - V36, already counted among the bugs above, went from a model difference we stood behind to a hole we now own.</p>

<p>The delegation question - our 13 MODEL-class divergences, where we clamp delegate spend to the owner's cap instead of rejecting - he turned into a spec proposal: <a href="https://github.com/ashedrack/mandata/issues/33">ashedrack/mandata#33, a v0.5 draft for optional clamp semantics</a> with 21 fresh vectors (K01-K16, KD01-KD05) exercising authorize-by-effective-cap, replay conflict, and claim binding. Both sides reviewed the draft; the shape froze at <code>a91b7f4</code> with three of our asks in it - <code>effective_cap</code> mandatory on clamped decisions, an explicit line that a check id on an allowed decision names the adjusting bound (not a denial), and a &sect;7 sentence marking the "same amount, new <code>tx_id</code>, after a cap change" gap as deliberately deferred pending a tighten op - the honest bookmark the future tighten proposal hangs on. Running those 21 through our TypeScript harness is the next epic; the corpus that audited us is getting vectors we co-designed.</p>

<p>While this post sat in draft, Shedrack merged his own <a href="https://github.com/ashedrack/mandata/pull/34">zero-dependency TypeScript port</a> - gate, lifecycle, credentials, evidence, all 92 vectors byte-identical to the Python reference. MMF now has three implementations. Ours is the only one not written by the spec's author - the part that matters, because a same-author port cannot surface spec ambiguities the author already knows the intended answer to. His framing for the writeup, better than anything we drafted: <em>the first implementation written against the spec rather than alongside it.</em></p>

<p>One honest caveat he asked us to name, and we will: the replay and conflict paths - <code>REPLAY</code>, <code>TX_CONFLICT</code>, the stored-decision machinery - are the part of the corpus he most wanted a second implementation to exercise, and they are exactly where our model reports <code>NOT_MAPPABLE</code>. An independent gate still hasn't exercised them. His <code>ts/</code> port's idempotent <code>tx_id</code> dedup is now the working reference for the decision-store work our run flagged as missing - which is what honest NOT_MAPPABLE is for: naming the gap, not hiding it in the tail.</p>

<p><img src="/images/blog/arc-c56-mmf-conformance-audit-i4.webp" alt="The auditor robot handing a sealed comparison-note envelope across a table to a second figure wearing a Mandata pin, a divergence spreadsheet visible between them" /></p>
<p><em>The divergence table goes to the spec author before the post goes to the feed. Divergences are rows to discuss, not scores to hide.</em></p>

<h2>What the audit itself was worth</h2>

<p>Beyond the corpus we probed our own invariants - tagged <code>source:"own-invariant"</code> so they never inflate MMF numbers:</p>

<ul>
<li><strong>Race matrix</strong>: the check-then-insert window reproduces on <em>every</em> backend, not just Postgres-shaped ones.</li>
<li><strong>Evidence matrix</strong> (7 deny branches &times; 6 fields): emit-branches always leave durable denied entries + typed alerts; exception branches leave nothing.</li>
<li><strong>Caller table</strong>: all 7 entry points audited for idempotency - and a dead path found: <code>spendAsDelegate</code> exists, fully implemented, wired to nothing.</li>
</ul>

<p>A conformance run doubles as a code review when you let it.</p>

<h2>Reproduce it</h2>

<pre><code>git clone -b mmf-255 git@github.com:spreadzp/agentbadge.git
cd agentbadge &amp;&amp; bun install
bunx vitest run tests/conformance/mmf/      # 43 tests
sha256sum -c tests/conformance/mmf/vectors/CORPUS.md   # corpus integrity</code></pre>

<p>Corpus pinned at tag <code>v0.4.24</code> (commit <code>9aba772</code>), results committed as <code>tests/conformance/mmf/results/*.json</code>, mapping rationale in <code>MAPPING.md</code>, bug triage in <code>EPIC-234-CANDIDATES.md</code>. The suite needs no network, no credentials, no database.</p>

<h3>Independently verified</h3>

<p>The committed reference didn't just survive our own re-runs. Four independent models - SWE-2 Max, Nemotron 3.5 Lightning High, GPT-6 Luna, and Claude Haiku 5.5 - each cloned <code>mmf-255</code> fresh, installed, and ran the suite with no access to our working tree. All four reported clean: 43/43 tests green, <code>results/*.json</code> regenerating byte-identically, corpus sha256 5/5 intact. Convergent findings from that review reclassified two vectors (<code>NOT_MAPPABLE</code> &rarr; <code>MODEL</code>) via a test-only fix in <code>faa882dc</code> - the production gate the vectors measure was not touched. One disclosed shortcut, in the spirit of this post: the planned cloud-agent verification run was quota-blocked, so the four-model quorum above is what stands.</p>

<h2>The point</h2>

<p>Anyone can say "we conform." A conformance <em>audit</em> says: here is the spec, here is our gate, here are the seven places we break our own contract, here are the 33 places we disagree on purpose, and here is the machine-readable evidence you can regenerate in one command. The findings live in the open on the Mandata repo - <a href="https://github.com/ashedrack/mandata/issues/31">delta findings</a>, <a href="https://github.com/ashedrack/mandata/issues/32">spec questions and rulings</a>, <a href="https://github.com/ashedrack/mandata/issues/33">the v0.5 proposal they spawned</a> - and the co-authored comparison note grows out of that thread, because a divergence list two parties signed is worth more than a badge one party granted itself.</p>

<p>If your agents move money, your gate has a spec - whether you wrote it down or not. Somebody else's corpus will find it for you.</p>

<p><em>Don't certify. Measure.</em></p>

<p><em>Next in the series: EPIC-234 - fixing what the audit found. Then the v0.5-clamp run: 21 vectors that exist because this audit disagreed honestly.</em></p>

<p><em>Read the arc: <a href="/blog/arc-c61-feedback-review">feedback infrastructure live</a> &middot; <a href="/blog/arc-c60-interaction-core">an inbox that proves what was said</a> &middot; <a href="/blog/arc-c59-knowledge-engine">verified knowledge for agents</a> &middot; <a href="/blog/arc-c58-counterparty-trust">counterparty trust on x402</a> &middot; <a href="/blog/arc-c55-a2a-settlement">a2a settlement</a></em></p>
`;
