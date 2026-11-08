/**
 * SLICE-216-6 · EPIC-162 C44 — Brick #5: Live on Arc Testnet (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c44-live-testnet/AgentBadge-Blog.md
 */
export const supplyChainLiveTestnetContent = `
<p class="series-note"> Final brick of the MVP wave - start here: <a href="/blog/bedrij-principle">The Bedrij Principle</a>, then <a href="/blog/supply-chain-participant-roles">Brick #1: Typed Participants</a>, <a href="/blog/supply-chain-typed-evidence">Brick #2: Typed Evidence</a>, <a href="/blog/supply-chain-scenario-matrix">Brick #3: Scenario Matrix</a> and <a href="/blog/supply-chain-verifiable-showcase">Brick #4: Verifiable Vitrine</a>. The hypothesis under test: a complex economic system can be composed from verifiable state transitions. </p>

<p> Four bricks built and armored the write path: typed participants, typed evidence, a scenario matrix that survives seven named violations, and a public replay view. The anchor article ended with a promise - <strong>"The experiment has started."</strong> This article is the receipt: on 2026-11-08 a real three-hop shipment ran the full custody cycle on Arc testnet, each hop escrowed in its own ERC-8183 job, all three settled and verified in 53 seconds. <strong>Proof -&gt; acceptance -&gt; settlement, on real rails, with transaction hashes you can open yourself.</strong> </p>

<h2>What exactly ran?</h2>

<p> <strong>Short answer:</strong> shipment <code>dogfood-1794151620383</code> - a cold-chain delivery with three hops, played by three different participant types from Brick #1. A shipper contracted an agent (<em>Plant intake</em>), the agent handed custody to a device (<em>ColdVan unit</em>), and the device delivered to an org (<em>Restaurant</em>). Each hop carried a 0.01 USDC escrow in its own ERC-8183 job on the ref proxy <code>0x0049e5...bf6a0</code>, Arc testnet (chainId <code>5042002</code>). Result: status <code>completed</code>, 3/3 hops verified, <code>outstandingUsdc: "0"</code>. </p>

<p> The shipment, in one table: </p>

<table>
  <thead><tr><th>hop</th><th>leg</th><th>job</th><th>create tx</th><th>settle tx</th></tr></thead>
  <tbody>
    <tr><td>0</td><td>shipper -&gt; agent (Plant intake)</td><td>66</td><td><a href="https://testnet.arcscan.app/tx/0x606f189928acbfc03af27419d2e324868a2e11fac15e2a2c75d3d1f2e5c6995e">0x606f18...</a></td><td><a href="https://testnet.arcscan.app/tx/0xf15f6e1e11237427a62cc050c7cd4ec517a25d497d804b1a0d437f4e0d070a05">0xf15f6e...</a></td></tr>
    <tr><td>1</td><td>agent -&gt; device (ColdVan unit)</td><td>67</td><td><a href="https://testnet.arcscan.app/tx/0xf9ebb85b65f54764d9925687b88003637f5973b3ce0d2d3c39124f3db05e57a7">0xf9ebb8...</a></td><td><a href="https://testnet.arcscan.app/tx/0x35f507f1d8654fa7269a8e6d95495bbc9a1b5e1fb0539c485de5f7c52c97b542">0x35f507...</a></td></tr>
    <tr><td>2</td><td>device -&gt; org (Restaurant)</td><td>68</td><td><a href="https://testnet.arcscan.app/tx/0xdc7c70beed73c41d60b99763b36c9e4cab5f7bf73fe8852141052501fec5c3ff">0xdc7c70...</a></td><td><a href="https://testnet.arcscan.app/tx/0x7798a4e627633c897ad256319d0d1158b2ecbcc5a5e2de02fdbd7b886db1df39">0x7798a4...</a></td></tr>
  </tbody>
</table>

<p> Six real transactions - three job creations, three settlements. Not a fixture, not a fork, not a replayed simulation: Arc testnet, confirmed on the public explorer. </p>

<p> The participants are real keys with real labels (Brick #1's typed roles, live): </p>

<table>
  <thead><tr><th>role</th><th>address</th><th>type</th></tr></thead>
  <tbody>
    <tr><td>client (shipper)</td><td><code>0xcdd23d104AA4C10DE65F4DD0571eDfeC0458699d</code></td><td>org</td></tr>
    <tr><td>hop 0 provider - Plant intake</td><td><code>0xb21fa9D9CE930FAf52545318169569007c027005</code></td><td>agent</td></tr>
    <tr><td>hop 1 provider - ColdVan unit</td><td><code>0x67d43A4065Dd69165061062B3128EDA50f1F7C96</code></td><td>device</td></tr>
    <tr><td>hop 2 provider - Restaurant</td><td><code>0x8B9FC021430c4fAD90389DcbdE4B1140012Cd98D</code></td><td>org</td></tr>
    <tr><td>evaluator</td><td><code>0xc9fA59e889c25b7f0b9494ed5c6bC62fe7EcCC56</code></td><td>signer</td></tr>
  </tbody>
</table>

<h2>What did each hop actually execute on-chain?</h2>

<p> <strong>Short answer:</strong> the full ERC-8183 lifecycle, not just an event log entry. Per hop the executor drives four stages of contract state: the provider signs <code>setBudget</code>, the client <code>approve</code>s and <code>fund</code>s the escrow, the provider <code>submit</code>s the deliverable, and the evaluator <code>complete</code>s the job - releasing escrow only after the accept. </p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-live-testnet-d1.webp"
       alt="Flowchart of the live shipment: the shipper hands custody through three ERC-8183 jobs - hop 0 job 66 shipper to agent, hop 1 job 67 agent to device, hop 2 job 68 device to org - each hop runs the same four-stage lifecycle, provider setBudget then client approve and fund then provider submit then evaluator complete; the append-only ledger records 13 events in 53 seconds with 0 USDC outstanding and the whole run is replayable at GET /api/ledger/shipments/dogfood-1794151620383, with a flagged honesty note that pay and txHash fields are ledger-asserted and the explorer links are the independent check" />
  <figcaption> The live run end to end: three hops, one lifecycle per hop, six transactions into the ledger - and the public replay anyone can curl. Dashed edge: the honesty flag that ships with the response itself. </figcaption>
</figure>

<p> That ordering is the Bedrij primitive running on contract state instead of test fixtures. Hop i+1 cannot hand off before hop i is paid - the same <code>ShipmentOrderError</code> guard the scenario matrix breaks against, now re-deriving state from a log whose <code>pay</code>/<code>verify</code> events were produced by real settlement transactions. The economic loop the anchor drew as <code>proof -&gt; acceptance -&gt; settlement</code> fired three times in 53 seconds of wall clock (15:27:41Z - 15:28:34Z). </p>

<p> And because the run wrote to the production Postgres ledger (<code>SC_DOGFOOD_DB=1</code>), the whole timeline is publicly replayable - Brick #4's vitrine, pointed at a real shipment: </p>

<pre><code>curl https://agentbadge.xyz/api/ledger/shipments/dogfood-1794151620383</code></pre>

<pre><code>{ "shipmentId": "dogfood-1794151620383", "status": "completed", "timeline": [ "13 events, 15:27:41Z - 15:28:34Z" ], "hops": [ "3 hops, all verified, jobs 66/67/68" ], "aggregate": { "completedPct": 100, "outstandingUsdc": "0" } }</code></pre>

<p> (Truncated for print - the verbatim response is at the URL above and in the evidence pack.) </p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-live-testnet-2.webp"
       alt="A three-car conveyor train on glowing rails moving through a testnet landscape: three crates marked agent, device and org each carry a 0.01 USDC escrow capsule; below each car a small green checkmark and a transaction hash; a timestamp ribbon reads 53 seconds" />
  <figcaption> The custody cycle on real rails: three hops, three escrowed jobs, six confirmed transactions, 53 seconds of wall clock. </figcaption>
</figure>

<h2>What did running it live actually find?</h2>

<p> <strong>Short answer:</strong> four executor bugs that no test caught, because the in-memory chain lets any key call any method. The ref contract does not. Running against real signatures exposed the write path's hidden assumptions - which is exactly why a live dogfood is the last brick, not the first. </p>

<ul>
  <li><strong>Provider-signed <code>setBudget</code>.</strong> The ERC-8183 ref variant restricts <code>setBudget</code> to the provider account. The executor used to send it as the client - on a real contract that is a revert, in a test it is silent. Fix: <code>spec.providerKey</code> plus a <code>sendAsAccount</code> path that signs locally and broadcasts the raw transaction.</li>
  <li><strong>Provider-signed <code>submit</code> before <code>complete</code>.</strong> <code>complete</code> requires the job to be in <code>Submitted</code> status - the provider must declare the deliverable first. The earlier order tried to complete directly after funding.</li>
  <li><strong><code>ClientCannotBeProvider</code>.</strong> Hop 2's receiver is the restaurant - but the client wallet cannot also act as a provider. The run needed a dedicated restaurant key (<code>SC_DOGFOOD_RESTAURANT_KEY</code>) or the contract refused the hop.</li>
  <li><strong>Resume, don't orphan.</strong> A failed live run leaves funded-but-unfinished jobs on-chain. <code>SC_DOGFOOD_RESUME_JOBS</code> reuses them instead of orphaning escrow - the same C-1 orphan-escrow finding the audit flagged before we ever went live.</li>
</ul>

<p> Two earlier attempts informed this one. An in-memory run (<code>dogfood-1794150937615</code>, jobs 63/64/65) exercised the resume path on reused jobs; the DB-backed run above is canonical because it is the one the public replay serves. </p>

<h2>Did the audit hold up under live fire?</h2>

<p> <strong>Short answer:</strong> yes - the two Critical findings were exactly the class of bug that kills a live run, and both were fixed before the first testnet transaction. Audit first, live second: the gate was load-bearing. </p>

<p> Brick #5 had its own external adversarial review before going live. Verdict: REQUEST CHANGES - 2 Critical, 4 High confirmed. C-1 was the orphan-escrow hole: if <code>createShipment</code> succeeded on-chain but the ledger write failed, escrow sat funded with no record. C-2 was a fail-open budget path - a null/zero-amount job could slip past as a plan of <code>"0"</code>. Both were fixed and re-verified, the pack went from 87/87 to <strong>99/99 green</strong> with 12 new regression tests, and only then did the executor see a real network. The findings that would have lost testnet escrow were found by an auditor, not by a revert. </p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-live-testnet-3.webp"
       alt="A glass audit shield standing in front of a blockchain rail line: inside the shield a clipboard lists C-1 orphan escrow and C-2 fail-open budget both stamped fixed; behind the shield a small train passes safely; badge reads REQUEST CHANGES resolved 99/99" />
  <figcaption> The gate that held: two Critical findings - orphan escrow and fail-open budget - fixed and re-verified before the first live transaction. </figcaption>
</figure>

<h2>What does this prove - and what does it still not prove?</h2>

<p> <strong>Short answer:</strong> the transition contract executes on real rails. It does not yet prove automated verification, non-linear chains, or real money at scale - and the article says so in the same breath as the result. </p>

<table>
  <thead><tr><th>claim</th><th>status 2026-11-08</th></tr></thead>
  <tbody>
    <tr><td>Verifiable transitions compose into a chain</td><td><strong>proven</strong> - 3 hops, ordered, verified</td></tr>
    <tr><td>Per-hop escrow on a real contract</td><td><strong>proven</strong> - ERC-8183, 6 confirmed txs</td></tr>
    <tr><td>Ordering enforced from an append-only log</td><td><strong>proven</strong> - same guard as Brick #3</td></tr>
    <tr><td>Public replay of a real shipment</td><td><strong>proven</strong> - endpoint live now</td></tr>
    <tr><td>Automated evidence evaluation</td><td>still manual - a delegated evaluator gates each settle</td></tr>
    <tr><td>Evidence authenticity</td><td>advisory - typed refs, self-declared</td></tr>
    <tr><td>Non-linear / branching chains</td><td>linear hops only</td></tr>
    <tr><td>Real-value settlement</td><td>0.01 USDC per hop, testnet gas</td></tr>
  </tbody>
</table>

<p> Three honesty notes matter for anyone replaying the shipment. The <code>pay</code>/<code>txHash</code> fields in the replay response are <strong>ledger-asserted</strong> - written by our executor, not independently chain-verified (the tx hashes above are the independent check; open them). Settlement was <strong>ops-settled</strong> - the evaluator signer is a delegated operations key, not the logical evaluator in the plan. And the amounts are deliberately tiny: a dogfood run proves the rail, not the revenue. </p>

<h2>The experiment ran</h2>

<p> The anchor article asked whether a complex economic system could be composed from verifiable state transitions, and promised five bricks of measurement. The bricks are laid: </p>

<pre><code>roles      - who acted          (Brick #1)
evidence   - what they claim    (Brick #2)
matrix     - how it breaks      (Brick #3)
vitrine    - how you check      (Brick #4)
live       - did it run         (Brick #5 - this)</code></pre>

<p> What shipped in one number: <strong>53 seconds, 3 hops, 6 transactions, 13 log events, 0 USDC outstanding</strong> - a custody cycle that a stranger can re-derive from a public endpoint, with the transaction hashes in the explorer one click away. The transition contract did not just type-check against a fixture. It settled. </p>

<p> That is the whole answer to the hypothesis. Not "we believe it works" - here is the shipment, replay it. </p>

<hr />

<h2>For AI Agents</h2>

<ul>
  <li><strong>What this proves:</strong> proof -&gt; acceptance -&gt; settlement executed on real rails - a three-hop ERC-8183 custody cycle settled on Arc testnet (chainId 5042002), publicly replayable via <code>GET /api/ledger/shipments/dogfood-1794151620383</code>.</li>
  <li><strong>Live surface:</strong> <code>GET https://agentbadge.xyz/api/ledger/shipments/dogfood-1794151620383</code> - canonical <code>ShipmentReplayResponse</code>, no auth; ref proxy <code>0x0049e5362736c933055e502b3cf3ba90cc0bf6a0</code>, jobs 66/67/68.</li>
  <li><strong>Lifecycle per hop:</strong> provider <code>setBudget</code> -&gt; client <code>approve</code>+<code>fund</code> -&gt; provider <code>submit</code> -&gt; evaluator <code>complete</code>.</li>
  <li><strong>Honesty flags:</strong> <code>pay</code>/<code>txHash</code> fields are ledger-asserted; evidence is advisory; settlement is ops-evaluator-gated; linear hops only; 0.01 USDC per hop.</li>
  <li><strong>Series:</strong> <a href="/blog/bedrij-principle">The Bedrij Principle</a> -&gt; <a href="/blog/supply-chain-participant-roles">Brick #1</a> -&gt; <a href="/blog/supply-chain-typed-evidence">Brick #2</a> -&gt; <a href="/blog/supply-chain-scenario-matrix">Brick #3</a> -&gt; <a href="/blog/supply-chain-verifiable-showcase">Brick #4</a> -&gt; this.</li>
</ul>

<p> Building agent-native supply chains? The ledger package is <code>@agentbadge/econ-events</code> on npm, and the anchor hypothesis this brick closes is in <a href="/blog/bedrij-principle">The Bedrij Principle</a>. </p>

<p><em>Don't certify. Measure.</em></p>
`;
