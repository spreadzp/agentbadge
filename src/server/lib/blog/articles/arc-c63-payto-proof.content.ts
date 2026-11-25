/**
 * EPIC-258 · arc C63 — x402 payout proofs: out-of-band signed proof
 * sets (DNS TXT + well-known), dogfood-first verification that caught
 * a real DoH parsing bug, freshness fields on evidence, and a stateless
 * recheck ontology where SERVFAIL is never a revocation (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c63-payto-proof/AgentBadge-Blog.md
 */
export const arcC63PaytoProofContent = `
<h2>The problem: the person quoting the address is the person who profits from it</h2>

<p><em>For a junior: x402 is the protocol where an API answers <code>402 Payment Required</code> - "pay this much crypto to this address, come back with a receipt, get your answer." Our scanner asks a site for its payment quote and sees <code>payTo: 0x...</code>.</em></p>

<p>Here is the uncomfortable part. <strong>Everything in that quote is self-reported by the seller.</strong> A compromised endpoint - or a dishonest one - can answer with <em>any</em> address. The agent signs, the crypto moves, no chargeback. Checking the endpoint's reputation does not help: the endpoint can be honest today and hijacked tomorrow.</p>

<h2>The flip: prove it out-of-band, where the endpoint cannot reach</h2>

<p><code>x402payto1</code> is a draft spec (under review in <a href="https://github.com/x402-foundation/x402/issues/4320">x402-foundation/x402#4320</a>, authored by <a href="https://github.com/benmcalillycreative">Ben McAlilly</a>) with a simple shape: the business - the domain owner - publishes a signed list of its payout addresses in places the endpoint does not control:</p>

<ul>
<li>a DNS TXT record at <code>_x402-payto.&lt;domain&gt;</code> (<code>v=x402payto1; a=0x...; d=2026-11-22; s=0xsignature</code>), and/or</li>
<li>a JSON file at <code>/.well-known/x402-payto.json</code>.</li>
</ul>

<p><img src="/images/blog/arc-c63-payto-proof-i2.webp" alt="Out-of-band proof flow - a payment terminal quotes payTo to a customer robot while the domain's own mailbox drops a signed card into a DNS slot, and an inspector robot compares the quote against the signed card with a red flag over a mismatched decoy address" /></p>
<p><em>The check runs outside the agent's payment path - the endpoint cannot fake a record it does not own.</em></p>

<p>The check then runs <strong>outside the agent's payment path</strong>: do the addresses the live 402 challenge quotes actually appear in the proof set the domain published? The endpoint cannot fake a DNS record it does not own, and it cannot edit a well-known file served from the domain itself.</p>

<h2>Dogfood first: we published our own before writing the rule</h2>

<p>Our convention is dogfood-before-rule: we cannot ask anyone to run a check we have not run on ourselves. So on 2026-11-22 we published a proof for <code>agentbadge.xyz</code> - a signed TXT record plus the well-known file - and ran the verification script against ourselves.</p>

<p>It caught a bug immediately - in our <em>check</em>, not our record.</p>

<p>Two public DNS-over-HTTPS resolvers format TXT answers differently: dns.google returns the <code>data</code> field bare, cloudflare-dns returns it wrapped in RFC-1035 quotes. A strict parser reads them as two different records - and a "both resolvers must agree" safety check fails on a perfectly honest proof. We found this <strong>on our own domain, before the rule existed</strong> - the kind of bug that would have failed every legitimate deployment and passed every crafted one.</p>

<p>We reported it. The spec now requires verifiers to normalize quoted and bare DoH TXT data - credited. A second finding landed the same way: the live <code>accepts[]</code> in a 402 challenge are authoritative; the <code>/.well-known/x402.json</code> manifest is only a hint. Both are in the draft now.</p>

<h2>What the rule actually checks (three flavors of "no")</h2>

<p><img src="/images/blog/arc-c63-payto-proof-d1.webp" alt="Proof-flow swimlane - seller endpoint quotes accepts, domain owner publishes a signed proof set via DNS TXT and well-known, scanner resolves dual-DoH plus live probes and evaluates to verdict chips VERIFIED, CONFLICT, GAP, UNCHECKED" /></p>

<p>The shipped checkers (AB-188 for x402 quotes, AB-189 for MPP/L402 payment challenges) do not answer "verified or not." They answer one of several very different things:</p>

<ul>
<li><strong>VERIFIED</strong> - every live-quoted payout address appears in the proof set (<code>dns</code>, <code>dns_signed</code>, <code>site</code> levels reported separately).</li>
<li><strong>CONFLICT</strong> - the site quotes an address that is provenly absent from the set. This is the "endpoint is paying someone else" case.</li>
<li><strong>GAP</strong> - no proof published. Most of the web today; we attach a fix hint.</li>
<li><strong>NOT_APPLICABLE / unchecked</strong> - we <em>could not verify</em> (resolver failure, probe failed). <strong>Unchecked is not absent.</strong> A flaky DNS day is not evidence of anything.</li>
</ul>

<p><img src="/images/blog/arc-c63-payto-proof-i3.webp" alt="Three doors in a row - door one green-lit with a matching seal marked VERIFIED, door two boarded up with a no-proof-posted note marked GAP, door three behind fog with a could-not-see-today umbrella marked UNCHECKED" /></p>
<p><em>Three different "no"s - that last distinction is the one that saves you from crying wolf.</em></p>

<h2>Freshness: "a valid old proof" is not "a current proof"</h2>

<p>The first reply we got after describing this on LinkedIn - from a founder who had independently built the same shape - cut straight to it: the check date matters, and it has to live outside the agent.</p>

<p>So every evidence row now carries <code>observed_at</code> (when <em>we</em> saw the quote, per probe, with <code>probe_id</code> and <code>observer</code> labels), and the report computes <code>issued_age_days</code> + a <code>stale_issued</code> flag when the proof is older than 30 days - informational, never a downgrade. An old proof still verifies; a stale one is just a stale one. And a proof dated in the future gets flagged, not trusted.</p>

<h2>Recheck: what happens when an address <em>leaves</em> the set</h2>

<p>Then three different reviewers - independently, within two days - hit the direction everyone misses: rotation. A business rotates a wallet or drops an address; a standing allowlist keeps paying the old one until a human edits it.</p>

<p>So we built the second half: <code>diffPaytoReports</code>, a pure function that takes two scan reports and classifies every member of the proof set:</p>

<ul>
<li><code>still_verified</code> / <code>still_absent</code> - nothing moved;</li>
<li><code>newly_proven</code> / <code>REAPPEARED</code> - an address joined (or came back);</li>
<li><code>DROPPED</code> - an address that <em>was</em> proven is now gone - <strong>but only on confirmed absence</strong> (a live lookup, resolvers agreeing, not a cache hit);</li>
<li><code>ROTATED</code> - drop + add in one move, paired both ways;</li>
<li><code>SCOPE_CHANGED</code> - same payee, different provenance (child→parent record move is not "the same proof");</li>
<li><code>recheck_unchecked</code> - <strong>the critical one</strong>: a SERVFAIL or resolver flap is <em>never</em> a revocation. Absence ≠ revocation ≠ loss-of-observability - three different events, three different responses.</li>
<li><code>CONFLICT</code> - signature that was valid went invalid.</li>
</ul>

<p><img src="/images/blog/arc-c63-payto-proof-i4.webp" alt="A ledger page where one address line fades out with an eraser ghost marked DROPPED while a new line is inked in beside it with a ROTATED arrow, and a storm cloud labeled SERVFAIL crossed out with a not-a-revocation circle" /></p>

<p><img src="/images/blog/arc-c63-payto-proof-d2.webp" alt="Transition map - previous scan set cross current scan set producing kind badges still_verified, newly_proven, DROPPED, ROTATED, SCOPE_CHANGED, REAPPEARED, recheck_unchecked, CONFLICT, with the callout DROPPED only on confirmed absence" /></p>

<p>A <code>DROPPED</code> transition renders as a medium alert: <code>0x23dd… was proven 2026-11-20, absent 2026-11-24 — possible rotation or compromise</code>. The scanner itself stays stateless: history is an <em>input</em> (two snapshots), not hidden state.</p>

<h2>Production evidence</h2>

<ul>
<li><strong>Self-scan, live</strong>: <code>agentbadge scan https://agentbadge.xyz</code> → AB-188 <strong>VERIFIED (dns_signed)</strong> - both live accepts (eip155:5042 and eip155:5042002) match the DNS proof, signature valid, <code>issued_age_days: 2</code>, <code>absence_confirmed: true</code>. AB-189 VERIFIED on the MPP path; AB-190 VERIFIED (extension declared).</li>
<li><strong>Dogfood re-run</strong>: <code>VERIFIED (dns_signed)</strong> on both tiers, both public DoH resolvers agreeing, run-log appended as evidence.</li>
<li><strong>Negative matrix</strong>: 30+ e2e scenarios green - mismatch→CONFLICT, malformed→GAP+hint, absent→GAP, resolver disagreement→unchecked, double-probe divergence→possible_per_payment (not a mismatch), SERVFAIL→<code>recheck_unchecked</code> never <code>dropped</code>.</li>
<li><strong>Adoption</strong>: the draft is live on ~3 domains (ours, settlewatch, madebydevx, api.teppi.xyz) and under foundation review.</li>
<li><strong>Arc Studio audit</strong>: we ran an external adversarial review over the whole proof surface before shipping this. Verdict: <strong>BLOCK</strong> - 2 Critical, 4 High, 14 Medium, every critical/high reproduced in a scratch harness. The best catch: a well-known fetch timeout used to silently mark a site-tier proof <code>DROPPED</code> - a false revocation on a flaky day. All reproduced findings were fixed and re-tested (1342 scanner tests + 63 lib tests green); the evaluators you install today are <code>@agentbadge/x402-payto-proof@0.2.2</code>.</li>
</ul>

<h2>Try it</h2>

<p>Your own domain is one TXT record plus one offline signature away: publish <code>v=x402payto1; a=&lt;your payout address&gt;; d=&lt;today&gt;; s=&lt;sig&gt;</code> at <code>_x402-payto.&lt;your-domain&gt;</code> and run <code>agentbadge scan https://&lt;your-domain&gt;</code> - AB-188 tells you whether the check would pass. The evaluator is open source as <a href="https://www.npmjs.com/package/@agentbadge/x402-payto-proof"><code>@agentbadge/x402-payto-proof</code></a> - zero-IO, deterministic, you supply the clock.</p>

<p>The honest limit: this proves the <em>published set</em>, not the seller's honesty. An address can be proven and the endpoint can still lie about price. That is what the counterparty layer (<a href="/blog/arc-c58-counterparty-trust">arc-c58</a>) is for - evidence at both ends, neither trusting the other's word.</p>
`;
