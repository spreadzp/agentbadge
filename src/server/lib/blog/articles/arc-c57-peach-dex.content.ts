/**
 * EPIC-254 · EPIC-162 C57 — Peach DEX integration: EURC→USDC→BudgetVault,
 * crash-safe tx journal, vendor-API bug hunt (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c57-peach-dex/AgentBadge-Blog.md
 */
export const arcC57PeachDexContent = `
<h2>The problem: "convert currency" is three problems wearing a trenchcoat</h2>

<p><em>For a junior: our BudgetVault is a USDC piggy bank for AI agents - it streams funds on a schedule, with a payee allowlist and per-tx caps. Customers in Europe hold EURC. So the agent needs a conversion step before the vault sees a cent.</em></p>

<p><em>This is part of the Arc campaign series. Previous published episode: <a href="/blog/arc-c55-a2a-settlement">the settlement layer for agents paying agents</a> (EPIC-227 - what decides when the money is allowed to move). This article is EPIC-254: plugging an external DEX aggregator into the agent's funding path - without trusting it.</em></p>

<p>That sounds like one API call. It is actually three separate problems:</p>

<ul>
<li><strong>The swap</strong> - easy part. Ask the aggregator for a quote, sign a transaction, collect USDC.</li>
<li><strong>The crash</strong> - hard part. Your process can die at <em>any</em> point between "I signed a transaction" and "I saw its receipt". A naive retry broadcasts the same intent twice. A naive "it failed, resend" pays twice. The only safe answer is a journal that knows exactly what was already signed and sent.</li>
<li><strong>The vendor</strong> - sneaky part. The SDK you depend on returns routers, quotes and flags. If any of them lie or drift shape, your checklist has to notice <em>before</em> the signature, not after the loss.</li>
</ul>

<p>We proved all three live on Arc testnet (chain <code>5042002</code>), in public, with transactions anyone can verify on the explorer.</p>

<h2>What actually shipped</h2>

<p><img src="/images/blog/arc-c57-peach-dex-d1.webp" alt="EURC to BudgetVault crash-safe pipeline: pre-sign checklist with router match, 0x02fcde22 calldata word-pin, gas and payee checks, atomic journal write before broadcast; money path through broadcast, on-chain verify, approve, deposit to DEPOSITED; crash zone showing process killed after broadcast with same-hash adoption and zero resends; never-sent block-body proof box; vendor API bug panel" /></p>
<p><em>Write the journal first - then the money moves.</em></p>

<p><strong>The happy path, end to end.</strong> 5 EURC in, quote fetched, the router verified against what the API advertises, intent + txHash + raw signed bytes written to the journal <em>in one atomic write</em>, then - and only then - broadcast. The swap returned 9.709 USDC, provenance-verified against actual token movements (not just the receipt status), and the full amount was deposited into the vault, which flipped to DEPOSITED and started streaming. Three full cycles, all on-chain:</p>

<ul>
<li>swap <code>0x4e2669ae…2339006</code> / deposit <code>0xa91b386f…dbc7b51</code></li>
<li>swap <code>0x6d6a830f…df1355</code> / deposit <code>0x04c485a9…85beb3</code></li>
<li>swap <code>0x758710f6…f36b60</code> / deposit <code>0xf29c17cc…c76651</code></li>
</ul>

<p><strong>The crash drill, for real this time.</strong> Not a mock - we killed the process after the swap was broadcast, restarted, and ran <code>resume</code>. It read the journal, found the signed intent, located the transaction on-chain under its <em>same hash</em>, adopted it, and finished the deposit. Zero resends. Then we did it again after all the audit fixes landed, on the hardened code, and it still worked.</p>

<p><img src="/images/blog/arc-c57-peach-dex-i2.webp" alt="Crash drill split panel: left half a robot at a swap broadcast console struck by lightning with the screen dark; right half a resume robot holding the paper ledger up to a chain of blocks, a magnifier finding the same hash token already in a block, a green checkmark reading adopted - resends 0, and a red bin of duplicate transactions" /></p>
<p><em>Kill it after broadcast. The journal finishes the job.</em></p>

<p><img src="/images/blog/arc-c57-peach-dex-journal.webp" alt="Real journal entry screenshot: swap intent with sender 0x9264, nonce 20, advertised router, 5 EURC amountIn, 9709033 expected output verified on-chain, signed raw bytes and txHash 0x4e2669ae persisted before broadcast, plus the FSM history showing an earlier ABORTED stage from the router mismatch check" /></p>
<p><em>A real entry from <code>state/peach-e2e.json</code> - signed bytes and hash persisted before broadcast; below it, the run that aborted on the router mismatch.</em></p>

<p><strong>"Never sent" means <em>provably</em> never sent.</strong> This is the part most retry logic gets wrong. An RPC timeout, a dropped connection, a misleading error name - none of that proves a transaction died. Our journal only marks an intent <code>never-sent</code> after a block-body proof: binary-search the signer's nonce across archive blocks, read the block where the nonce moved, and require the consuming transaction to be physically present. Until that proof exists, the intent is <code>unknown</code> - and unknown blocks the run, it does not guess.</p>

<p><strong>The escape hatch is a loaded gun with a safety.</strong> If a transaction is genuinely stuck, an operator can <code>abandon</code> the intent - but only after two probes at least a block apart confirm it is not in any mempool or block, and then the next signature is <em>nonce-pinned</em> so two transactions can never fight over the same slot.</p>

<h2>Seven rounds of review - and where the bugs actually were</h2>

<p><img src="/images/blog/arc-c57-peach-dex-i4.webp" alt="Seven checkpoint doors receding into the distance: the first glowing red BLOCK, four amber doors with bug icons swept out, the sixth glowing green PASS with 0 critical and 0 high; behind it a second inspector robot in vendor colors holding a red card 1 High and three amber cards Medium, handing a fix-it list to the first robot who nails a green plaque f528fd3 fixed, re-drilled live" /></p>
<p><em>The bugs moved into the fixes - then ran out of places to hide.</em></p>

<p>We ran the same playbook as the settlement layer: adversarial audit rounds in Arc Studio until converged, then a second reviewer on the final tree. Six rounds went BLOCK -&gt; FAIL x4 -&gt; <strong>PASS (0 Critical / 0 High)</strong>. The honest detail: several of the late-round findings were bugs <em>inside the previous round's fix</em> - remediation is attack surface, and it earns its keep.</p>

<p>Then Randy - the Peach-side reviewer - did something better than a code read. He verified our transactions on-chain and sent back a re-check with one High and three Mediums, all reproduced:</p>

<ul>
<li><strong>High: we signed calldata we never decoded.</strong> The aggregator API builds the transaction; we were trusting its shape. If the layout ever shifts - a router upgrade, a different path count - we would happily sign a transaction sending money somewhere else. Now the pre-sign checklist pins the <code>0x02fcde22</code> layout <em>word by word</em>: chainId, router, signer, tokenIn/Out, amountIn, amountOutMin, expectedOut, deadline, path echo. One word moves, we refuse to sign.</li>
<li><strong>Medium: a lock race that reproduced 11/25 double-holders.</strong> Two processes could both believe they owned the journal lock. Fixed with an atomic rename - Randy literally reproduced the race and counted.</li>
<li><strong>Medium: a resume wedge</strong> on <code>dead:"reverted"</code> entries, and <strong>an ABORTED state with no reclaim path</strong> for transactions that mined anyway. Both fixed; the post-fix drill re-ran live.</li>
</ul>

<p>Plus a fresh independent checklist run by a different model family (Nemotron 3.5 Lightning): <strong>PASS</strong>. <code>bun test scripts/lib/</code>: 80 pass, 0 fail.</p>

<h2>The twist: the vendor's API was the bug report</h2>

<p><img src="/images/blog/arc-c57-peach-dex-i3.webp" alt="Robot detective with a magnifying glass inspecting a Peach API vending machine: the posted sign reads router 0x5FF5 but a service hatch reveals a second unlabelled pipe stamped 0xfcf7 feeding the same slot; two more bubbles show a wildly spinning clock labelled quote_ts ms not s and an empty receipt field stamped deviation_ratio absent; a clipboard reads 5 questions for the vendor" /></p>
<p><em>The sign says one router. The hatch shows another.</em></p>

<p>While auditing <em>our</em> handling of their API, we found real issues on the Peach/Arc side:</p>

<p><strong>1. Two routers, one advertisement.</strong> <code>getStatus()</code> proudly reports the execution router <code>0x5FF5…0607</code>. But the V2 <code>swapAllowance()</code> endpoint returns a <em>different</em> router, <code>0xfcf781…0663</code> - an address the status endpoint does not mention at all. Both are ERC1967 upgrade proxies with <em>different implementations</em>. Our checklist aborted on the mismatch (that is what it is for). Is <code>0xfcf781…</code> legitimate? We asked. If a checklist treats the API's own self-report as truth, this is exactly the class of thing that becomes an incident.</p>

<p><strong>2. <code>quote_ts</code> is in milliseconds.</strong> The field looks like seconds. A naive <code>age = now - quote_ts</code> in seconds makes an expired quote look fresh <em>forever</em> - we only caught it because a negative test fed a stale quote and watched the deadline check wave it through. Units are a security boundary.</p>

<p><strong>3. <code>deviation_ratio</code> just isn't there.</strong> Testnet quotes for EURC-&gt;USDC omit the field entirely. An earlier version of our code silently treated missing as 0 - which is how "the API didn't say" becomes "the API said zero". Now missing means <em>unknown</em>, and unknown fails closed.</p>

<p><strong>4. Arc's USDC is also the gas token.</strong> Gas is charged on the USDC address itself <em>and</em> a second Transfer event fires on <code>0xffff…fffe</code> at 18 decimals. Any verifier that diffs USDC Transfer logs naively misreads every transaction. We subtract <code>gasUsed x effectiveGasPrice</code> explicitly.</p>

<p><strong>5. Testnet prices are synthetic and drifting.</strong> Our five executed 5-EURC swaps returned 15.514, 13.484, 11.829, 10.460, 9.709 USDC - declining, consistent with our own price impact on a thin pool. Nothing on testnet should ever be quoted as a price. On mainnet, the read-only sweep says EURC-&gt;USDC sits at ~<strong>1.097</strong> across 5-500 EURC, median quote latency 799 ms.</p>

<h2>Honest residuals</h2>

<ul>
<li>Peach's answers are still open on: the unadvertised V2 router, <code>quote_ts</code> units, the missing <code>deviation_ratio</code>, whether the <code>0x02fcde22</code> calldata layout is stable across router upgrades, and cirBTC on testnet. Decision is <strong>CONDITIONAL GO</strong> until those land.</li>
<li>A second model-family verifier (Luna) never ran - our org's weekly quota ran out. It's on the record as an open residual, not swept.</li>
<li>~18 USDC residue sits in the signer wallet from an early swap that mined after its pre-journaling run aborted. Reported as a finding, not hidden.</li>
<li>Testnet prices are synthetic - cite the mainnet ~1.097 sweep only, never the 3.10-&gt;1.94 testnet numbers.</li>
</ul>

<h2>Why this matters beyond one swap</h2>

<p>The generic lesson is not "DEX aggregators work on Arc". It is that <em>plugging a third-party financial API into an autonomous agent is an audit problem, not an integration problem</em>. The API's self-reported status lied by omission (the router). Its types lied by unit (the timestamp). Its schema lied by absence (the ratio). None of that is malice - it is just what production APIs do. The only defence is a checklist that treats the vendor as untrusted input, a journal that treats every crash as survivable, and reviewers who verify on the chain instead of believing the code.</p>

<p>The full evidence pack - transcripts, sweep JSON, audit findings, the letter we sent the Peach team - ships in the repo under <code>spike-evidence/</code> on branch <code>spike/epic-254-peach</code>.</p>

<hr />

<p><em>C57 in the Arc Campaign series. Built on Arc: testnet <code>5042002</code> live, mainnet <code>5042</code> read-only. No contracts harmed in the making of this spike.</em></p>

<p><strong>Read the arc:</strong></p>

<ul>
<li><a href="/blog/arc-c55-a2a-settlement">The A2A settlement layer</a> (C55, EPIC-227) - the same audit-arc DNA: fifteen rounds where half the late findings lived inside the previous fix. Our 7-round version had the same shape.</li>
<li><a href="/blog/arc-c48-direct-usdc-engine">The direct USDC verification engine</a> (C48, EPIC-222) - the live on-chain read our provenance checks follow: receipts plus token deltas, not status alone.</li>
<li><a href="/blog/arc-c51-agent-commerce">Agent commerce</a> (C51, EPIC-224) - the six-state deal machines whose payouts this funding path eventually feeds.</li>
<li><a href="/blog/arc-c3-money-layer">The money layer</a> (C3) - how agents pay each other from any chain and settle on Arc; this spike adds EURC as an on-ramp into that USDC rail.</li>
</ul>
`;
