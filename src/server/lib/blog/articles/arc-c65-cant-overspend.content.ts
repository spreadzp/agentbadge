/**
 * EPIC-265 · arc C65 — hacksgiving agent: a Thanksgiving-shopping agent
 * isolated across two Sprites physically cannot overspend its $100/24h
 * cap - byte-verified production enforcement (sha256-pinned, 43/43
 * conformance), two independent adversarial audits, kill-tested
 * fail-closed, settlement demo-credit with the enforcement point
 * payment-rail-agnostic (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c65-cant-overspend/AgentBadge-Blog.md
 */
export const arcC65CantOverspendContent = `
<p><em>This is part of the Arc campaign series. Previous episode: <a href="/blog/arc-c64-operator-accountability">operator accountability - every config change stamped with a name</a> (EPIC-264). This article is EPIC-265: infrastructure-enforced agent budgets, built during Fly.io's Hacksgiving week.</em></p>

<h2>The problem: agents got wallets before they got limits</h2>

<p>For a junior reader, three things happened in the agent world this month, all on Fly.io - and they matter beyond one vendor:</p>

<ul><li><strong>Agents can sign themselves up.</strong> Fly now supports <code>auth.md</code>, an open spec where your coding agent registers an account with your email and gets its own short-lived credentials. No human copy-pasting API keys.</li><li><strong>Agents can pay.</strong> A connector called Link hands the agent a single-use virtual card, capped at an amount you approved in an app.</li><li><strong>Agents are sandboxed.</strong> A Sprite is a hardware-isolated Linux box the agent lives in; connectors are gateway proxies that hold the actual tokens - the agent never sees them.</li></ul>

<p>Notice what is missing. The cap on the Link card is <em>per purchase you approved</em>. The connector policy decides <em>which services</em> the agent may reach. But nothing answers the question a budget owner actually asks:</p>

<blockquote><p><strong>"What is the most this agent can spend today, no matter what it decides, no matter how it is prompted, no matter what bugs it hits?"</strong></p></blockquote>

<p>Not "per transaction." Not "if the model behaves." Total. Per day. Enforced by something the agent cannot talk its way around.</p>

<p>That is a hard question, because the agent is a language model: it is <em>persuadable</em> - by its own hallucinations, by prompt injection in a web page it reads, by a malformed tool response. Any limit the agent merely <em>knows about</em> is a limit it can be talked past. The limit has to live infrastructure-side.</p>

<h2>What we built: the gate is not part of the agent</h2>

<p>Our demo agent has a charming job: buy the full Thanksgiving table - turkey, gravy, cranberry, potatoes, stuffing, rolls, pie - from a demo grocery, on a budget of <strong>$100 per rolling 24 hours</strong>. Its brain is Ollama <code>llama3.2</code> running inside its own Sprite. No cloud LLM: the agent is small, local, and dumb enough to be honest about what agents really do.</p>

<p>The full table costs $113. Watch what the architecture does with that.</p>

<p><img src="/images/blog/arc-c65-cant-overspend-d1.webp" alt="Trust boundary diagram: agent sprite (brain, cart logic) separated from gate sprite (mandate gate, ledger) and connector/shop, with red crosses on the direct paths" /></p>

<p><em>The agent sprite has no path to the money that does not go through the gate. The red crosses are not firewall rules we hope hold - they are absent credentials and a provider-enforced policy.</em></p>

<p>The enforcement shape, in one breath: <strong>the agent sprite never holds the shop credential.</strong> It lives inside the Sprites connector - a gateway proxy that attaches the credential to passing requests. When the agent tried to call the connector directly, Fly's own label policy answered <code>403</code>. When it tried the shop directly, <code>401</code> - it simply has no key. The only door is the <strong>mandate gate</strong> on a second sprite, and the gate is not demo code:</p>

<ul><li>It is a <strong>byte-verified snapshot of the production mmf-255 spend-enforcement module</strong> - 59 of 62 files byte-identical to the upstream repo at a pinned commit, 3 disclosed deltas (more on those below - they are the audit story).</li><li>It passes the module's <strong>43-vector conformance suite</strong> - inside the deployment sprite, not just in CI.</li><li>It <strong>prices the cart itself</strong>, server-side, from its own catalog. Whatever total the agent claims is decoration.</li><li>It <strong>reserves budget before money moves</strong> against an append-only ledger - and the ledger fails <em>closed</em>: corrupted file, no purchases, full stop.</li></ul>

<h2>The demo: three denials and a turkey</h2>

<p>The agent's first cart is the full table - $113 against $100. The gate answers <code>DENY DAILY_CAP_EXCEEDED</code>, with the exact numbers. The agent replans - and being a small model, it does the most agent thing imaginable: it reshuffles the <em>same</em> cart and tries again. Twice.</p>

<p>This is the moment the video is really about. <strong>Reordering changes nothing, because nothing the agent controls is an input to the decision.</strong> The gate prices the cart from its own catalog every single time. Denied. Denied.</p>

<p>On round four the arithmetic lands: drop the pie, keep the turkey - $95. <code>ALLOW</code>. The gate reserves the budget, the connector attaches the credential the agent has never possessed, the shop settles, one receipt, one debit. The whole arc is one unedited run:</p>

<p><strong><a href="https://youtu.be/B0BtgH6Lvko">▶ Demo video (1:44)</a></strong> - byte-verification, the deny-replan arc, the adversarial probes, and the kill-test, narrated.</p>

<p><img src="/images/blog/arc-c65-cant-overspend-d2.webp" alt="Deny-replan arc diagram: round 1 full table $113 DENY, rounds 2-3 same cart reshuffled DENY, round 4 without pie $95 ALLOW, receipt tx_c0ad07149622cd04" /></p>

<h2>The part we are proudest of: it survived being audited</h2>

<p>Here is where most demo posts end and where ours starts. A spending gate you wrote yourself, tested yourself, and demo yourself is a claim. We wanted evidence.</p>

<p><strong>Audit one (adversarial review of the public code) came back with REQUEST CHANGES: 2 Critical, 2 High, 8 Medium</strong> - every critical with a working reproduction. The two that matter:</p>

<ul><li><strong>Rounding mismatch.</strong> The gate and the shop rounded fractional amounts differently. An agent sending <code>amountUsd: 0.005</code> two thousand times would be <em>debited $20</em> against a <em>$10 cap</em> - the cap metered a different number than the money moved. Reproduced.</li><li><strong>Client-declared amounts.</strong> The gate metered whatever total the agent claimed. A cart of $800 in goods "cost" $0 if the agent said so. Reproduced - with a receipt.</li></ul>

<p>Both are the kind of bug that passes every happy-path test and ships. Both were fixed the same day: server-side pricing from a trusted catalog (client amounts are ignored entirely), reconcile-not-release semantics, atomic ledger writes with fail-closed reads. The fix for the ledger finding matches a bug the upstream module had already documented for its own hardening epic - our delta is disclosed in the repo's <code>PROVENANCE.md</code>, because honest provenance is part of the claim.</p>

<p><strong>Audit two (independent cloud review) then attacked the fixed gate the way production gets attacked: with concurrency.</strong> Fifty parallel curls. Thirty same-tick promises. HTTP pipelining. Two hundred concurrent one-dollar executions against a ten-dollar cap. Final tally every time: exactly the cap, not a cent more. The reviewer independently byte-diffed our vendor tree against upstream - confirmed the provenance claim without trusting our manifest. Verdict: zero critical, zero high; the remaining medium-and-low findings (a reservation edge case on retries, a harness timeout mismatch) were fixed the same day too.</p>

<p>We are not aware of another agent demo whose headline is "the safety mechanism survived adversarial audit." We think it should be the baseline expectation.</p>

<p><img src="/images/blog/arc-c65-cant-overspend-i2.webp" alt="Two adversarial audits: first audit stamps REQUEST CHANGES with 2 critical findings on the envelope, second audit attacks with four concurrency lanes that splinter against a hardened steel gate" /></p>

<h2>The kill-test, or what "fail closed" actually means</h2>

<p>One more frame from the video. Mid-run, we freeze the gate process - not a polite shutdown, a <code>SIGSTOP</code>. The agent attempts purchases.</p>

<p>Nothing. <code>HTTP 000</code> - connection dead, no response at all. There is no fallback path, no "gate unavailable, proceeding optimistically," no silent pass. <strong>Purchases are simply impossible.</strong> Seconds later the service supervisor restarts the gate; the ledger is intact, every cent accounted for, budget accounting continuous.</p>

<p>If your safety mechanism has an uptime dependency, the honest question is what happens at 3 AM when it does not have uptime. Ours becomes a wall.</p>

<p><img src="/images/blog/arc-c65-cant-overspend-i3.webp" alt="The gate frozen in a block of ice mid-purchase, connection dead HTTP 000, while the ledger beside it stays intact and balanced" /></p>

<h2>Honest limits - because a claim you can't falsify is marketing</h2>

<ul><li><strong>Settlement in the demo is demo-credit</strong>, an internal balance in the demo grocery. No blockchain, no card network. The point is <em>where</em> enforcement lives: the decision happens before money moves, on payment-rail-agnostic production code. Swap the settlement rail - crypto, card, invoice - and the gate neither knows nor cares.</li><li><strong>The agent's replan loop is UX, not security.</strong> Sometimes the small brain needs three rounds to drop the pie. The cap does not depend on the agent ever figuring it out - that is the entire point.</li><li><strong>We control the whole environment</strong> - the shop is ours, the sprites are ours. That is what makes it a demo. What makes it more than a demo is that the enforcement code is production code, byte-verified, and the audits were adversarial rather than friendly.</li></ul>

<h2>Verify it yourself</h2>

<p>Everything in this article is reproducible:</p>

<pre><code>git clone https://github.com/spreadzp/hacksgiving-265
cd hacksgiving-265 &amp;&amp; bash scripts/verify.sh</code></pre>

<p>One command checks the vendor tree byte-for-byte against the pinned upstream commit, runs the 43-vector conformance suite, and fires seventeen behavioral attacks at a local instance - spoofed approvals, forged intents, replay, malformed bodies, corrupt ledger. Expected output: <code>20/20 PASS</code>. The adversarial probe results against the live deployment are committed at <code>evidence/demo-results.json</code>.</p>

<h2>Why this matters beyond a hackathon</h2>

<p>Agent payments are arriving as a <em>product surface</em> - signup specs, one-tap card approvals, connector catalogues. The platforms are competently solving "can the agent pay." The question they cannot answer for you is "<strong>should</strong> it, and how much, total, today" - because that is <em>your</em> policy, denominated in <em>your</em> risk tolerance.</p>

<p>That policy has to be enforced in a place the agent cannot negotiate with: server-side arithmetic, a ledger that fails closed, credentials the agent never holds, and - the part the industry skips - evidence that the mechanism survives someone actively trying to break it.</p>

<p>The agent in the video never learns what the cap is. It does not need to. That is what a budget is for.</p>

<p><em>The enforcement module is the production spend-gate of <a href="https://agentbadge.xyz/">AgentBadge</a> - infrastructure for agent payment accountability. The demo lives at <a href="https://github.com/spreadzp/hacksgiving-265">github.com/spreadzp/hacksgiving-265</a>.</em></p>
`;
