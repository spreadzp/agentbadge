/**
 * SLICE-215-6 · EPIC-162 C43 - Brick #4: Verifiable Vitrine (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c43-verifiable-showcase/AgentBadge-Blog.md
 */
export const supplyChainVerifiableShowcaseContent = `
<p class="series-note"> Part of the verifiable supply-chain series - start here: <a href="/blog/bedrij-principle">The Bedrij Principle</a>, then <a href="/blog/supply-chain-participant-roles">Brick #1: Typed Participants</a>, <a href="/blog/supply-chain-typed-evidence">Brick #2: Typed Evidence</a> and <a href="/blog/supply-chain-scenario-matrix">Brick #3: Scenario Matrix</a>. The hypothesis under test: a complex economic system can be composed from verifiable state transitions. </p>

<p> "Trust me" is not an API response. Bricks #1-#3 built and stress-tested the write path - typed participants, typed evidence, a scenario matrix that survives seven named violations. This brick opens the other side: <strong>a public, embeddable JSON vitrine that lets anyone replay a shipment's history and check the claims themselves.</strong> No login, no key, no SDK - <code>GET /api/ledger/shipments/:id</code> and the chain speaks for itself. </p>

<p> The Bedrij Principle predicts that if state transitions are truly verifiable, then a <em>composed</em> chain must be readable from the outside - the transitions' evidence can't hide behind the system that wrote it. This brick is the experimental proof of that sub-hypothesis: the same append-only log that drives the state machine now renders a <code>ShipmentReplayResponse</code> a stranger can audit. </p>

<h2>What is a shipment replay view?</h2>

<p> <strong>Short answer:</strong> a read model that walks the append-only event log for one <code>shipmentId</code>, applies the canonical-sequence rules from Brick #3, and returns a single JSON document - <code>status</code>, ordered <code>timeline</code>, per-hop detail (<code>roles</code>, <code>evidence</code>, <code>jobId</code>, status), an <code>aggregate</code> (completion %, current custodian, outstanding USDC), and a <code>limits</code> array stating what the view does <em>not</em> promise. One endpoint, <code>GET /api/ledger/shipments/:id</code>, public by design. </p>

<p> "Replay" is literal: there is no separate view table to trust. The endpoint re-derives state from <code>source=supply_chain</code> events keyed by <code>sourceId</code> - the same projection the write path uses internally. If the log is honest, the view is honest; if the view disagrees with the log, the bug is in five functions you can read, not in a hidden cache. </p>

<h2>Meet the shipment: a cold-chain run in plain words</h2>

<p> Picture a delivery any logistics manager would recognize. A biotech buyer contracts a refrigerated container of temperature-sensitive product at the Maasvlakte cold port in Rotterdam. The container has three legs: the port hands it to a trucking company, the trucker hands it to a pharma warehouse in Venlo. Each leg repeats the same three-step ritual - <strong>hand over custody, pay for the leg, verify the handoff.</strong> A reefer logger on the container writes temperature evidence, the port writes a bill of lading, the truck's telematics write GPS traces, and the dispatcher bot signs the acceptance. </p>

<p> In the demo chain below, leg one is finished - custody moved from port to trucker, 120.5 USDC paid, verification passed. Leg two is done and paid (85 USDC). Leg three is only <em>offered</em>: the warehouse hasn't accepted yet, 40.25 USDC still outstanding. Everything a courier's tracking page would show - plus the one thing it never shows: <strong>anyone can re-check the math.</strong> </p>

<h2>What does a real response look like?</h2>

<p> <strong>Short answer:</strong> below is the verbatim output of <code>shipmentReplay()</code> over a scripted three-hop demo chain mid-flight: hop 0 verified, hop 1 paid, hop 2 still offered. Not hand-written JSON - the chain was driven through the same <code>createShipment → handoffHop → settleHop → verifyHop</code> calls the API wraps, then read back by the replay pipeline that serves <code>GET /api/ledger/shipments/:id</code>. </p>

<pre><code>{ "shipmentId": "shp-demo-vitrine", "client": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "status": "in_progress", "timeline": [ { "seq": 1, "kind": "work_offer", "ts": "2026-11-07T21:01:40.500Z" }, { "seq": 3, "kind": "work_accept", "ts": "2026-11-07T21:01:40.503Z" }, { "seq": 4, "kind": "handoff", "ts": "2026-11-07T21:01:40.506Z", "hopIndex": 0 }, { "seq": 5, "kind": "pay", "ts": "2026-11-07T21:01:40.508Z", "hopIndex": 0 }, { "seq": 6, "kind": "verify", "ts": "2026-11-07T21:01:40.511Z", "hopIndex": 0 }, { "seq": 7, "kind": "work_accept", "ts": "2026-11-07T21:01:40.512Z" }, { "seq": 8, "kind": "handoff", "ts": "2026-11-07T21:01:40.512Z", "hopIndex": 1 }, { "seq": 9, "kind": "pay", "ts": "2026-11-07T21:01:40.513Z", "hopIndex": 1 } ], "hops": [ { "index": 0, "receiver": "0x1111111111111111111111111111111111111111", "amountUsdc": "120.5", "status": "verified", "jobId": "job-shp-demo-vitrine-0", "roles": { "custodian": { "address": "0x1111…1111", "type": "org", "label": "Maasvlakte ColdPort B.V." }, "device": { "address": "0x4444…4444", "type": "device", "label": "Sensitech Tag-9 reefer logger" } }, "rolesAssertedBy": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "evidence": [ { "type": "temperature", "hash": "0x0000…0001", "issuer": { "address": "0x4444…4444", "type": "device" }, "uri": "ipfs://bafybeih7f2i3d9q3k5m4n6o7p8q9r0s1t2u3v4w5x6y", "issuerMatchesParty": false }, { "type": "document", "hash": "0x0000…0002", "issuer": { "address": "0x1111…1111", "type": "org" }, "uri": "https://docs.coldport.example/bol/BX-2041", "issuerMatchesParty": true } ], "evidenceAssertedBy": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, { "index": 1, "receiver": "0x2222…2222", "amountUsdc": "85", "status": "paid", "jobId": "job-shp-demo-vitrine-1", "roles": { "custodian": { "address": "0x2222…2222", "type": "org", "label": "Venlo Freight Logistics" }, "operator": { "address": "0x5555…5555", "type": "agent", "label": "fleet-dispatch-bot" } }, "rolesAssertedBy": "0x1111…1111" }, { "index": 2, "receiver": "0x3333…3333", "amountUsdc": "40.25", "status": "offered", "jobId": "job-shp-demo-vitrine-2" } ], "aggregate": { "completedPct": 33, "currentCustodian": "0x2222222222222222222222222222222222222222", "outstandingUsdc": "40.25" }, "limits": [ "linear hops only", "manual settlement per hop", "evidence is advisory — not verified", "caps: ≤256 hops / ≤4096 events", "status lifted from canonical slots — writer trust at ledger layer" ] }</code></pre> <p> Three details in that payload carry the whole article. First, <code>rolesAssertedBy</code>/<code>evidenceAssertedBy</code> on every hop - the view never lets you forget <em>who claimed</em> the roles and evidence (Brick #1/2's self-declaration boundary, surfaced). Second, <code>issuerMatchesParty</code> - the reader can see that the temperature ref's issuer is the declared device, not a hop party, without trusting our word for it: the address is right there. Third, <code>timeline[].hopIndex</code> exists only on <code>handoff</code>/<code>pay</code>/<code>verify</code> events at canonical sequence slots - you'll see why that matters below. </p>

<p> Read it like a tracking page, then like an auditor. <code>timeline</code> is the event feed - the offer at seq 1, then accepts, handoffs, payments, and the <code>verify</code> at seq 6 that closed leg one. <code>hops[].roles</code> names who was involved - the port as custodian, the reefer logger as a device - and <code>hops[].evidence</code> lists their artifacts with <code>*AssertedBy</code> provenance: who <em>claimed</em> it, not who proved it. <code>aggregate</code> is the headline a dashboard would print: 33% complete, the trucker currently holding custody, 40.25 USDC left to pay. </p>

<p> If a dispute lands tomorrow - "the container arrived warm, who pays?" - this JSON is the document both sides start from, and neither of them had to produce it. That is the difference between a tracking page and a vitrine: the tracking page is the courier's word; this is the courier's arithmetic, checkable by a stranger. </p>

<h2>How does the read path stay honest?</h2>

<p> <strong>Short answer:</strong> the same canonical gate that protects the write-side projection guards the public view - and this brick's own adversarial audit made it stricter: timeline <code>hopIndex</code> lifts only from canonical-slot events bound to this shipment, plan membership is checked by index set (not count), oversized streams refuse instead of truncating silently, and every refusal is warn-logged with a reason. </p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-verifiable-showcase-2.webp"
       alt="The replay vitrine as a pipeline: event tickets offer, accept, handoff, pay, verify with seq numbers feed a glass dome labeled canonical replay where forged tickets bounce off; inside the dome tickets reorder into a neat shelf; a JSON card shows status in_progress, completedPct 33, custodian 0x2222, outstanding 40.25" />
  <figcaption> The read model as a pipeline: the append-only log feeds canonical replay; events on the wrong sequence slot, the wrong hop index or a foreign shipmentId bounce off and lift nothing - what survives reorders into the response on the right. </figcaption>
</figure>

<p> The read path end-to-end (diagram below): the request is rate-limited and shape-checked (<code>SHIPMENT_ID_RE</code> → honest <code>400 invalid_id</code>), the log scan binds <code>sourceId</code> to the requested id - the log is the source of truth - and the two-pass canonical replay lifts plan from the <code>work_offer</code> at seq 1, then lifts <code>handoff</code>/<code>pay</code>/<code>verify</code> only from canonical slots. Anything forged - wrong seq, foreign <code>shipmentId</code>, crafted terms - takes the drop path and lifts nothing, not even status. Completed shipments cache for 60 seconds; everything else is <code>no-store</code>; disabled storage and store errors answer <code>503 unavailable</code>, unknown ids <code>404</code>. </p>

<p> The everyday version of this check: recomputing a bank statement from the receipts instead of trusting the courier's tracking screenshot. A forged "handoff" ticket - wrong sequence, wrong shipment, wrong slot - is a receipt that doesn't belong in the pile, so replay drops it on the floor and logs why. </p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-verifiable-showcase-d1.webp"
       alt="Flowchart of the public read path: GET /api/ledger/shipments/:id passes rate limit and id shape, scans the supply_chain event source for the requested sourceId, replays through the canonical gate - plan binds at the seq-1 work_offer, handoff/pay/verify lift status and timeline hopIndex only from canonical slots, forged events drop into a warn-logged refuse - the result is a ShipmentReplayResponse that caches 60 seconds when complete and returns 503 on store failure or 404 on unknown id, which the reader verifies independently" />
  <figcaption> The read path end to end. The canonical gate is the same one Brick #3 regression-tests - the difference here is who it serves: anyone with HTTP, no credentials. </figcaption>
</figure>

<h2>What did the audit change - and why publish your own findings?</h2>

<p> <strong>Short answer:</strong> an external adversarial review of this endpoint returned REQUEST CHANGES - 0 Critical, 5 High, 7 Medium. All five Highs are fixed or documented with regression tests (<code>tests/supply-chain/replay-audit.test.ts</code>, 16 cases); the Mediums are fixed or explicitly accepted in the review doc. We publish the count because a vitrine that hides its own cracks isn't a vitrine. </p>

<p> The Highs, briefly: <strong>crafted terms</strong> (<code>hops</code> with holes, non-string <code>amountUsdc</code>, wrong types) could reach <code>BigInt</code> arithmetic and throw - now every terms/payload field is guarded before use, and <code>sumUsdc</code> fails with a bounded <code>ShipmentOrderError</code>. <strong>Timeline forgery</strong> - any event's <code>payload.hopIndex</code> used to annotate the timeline - now only canonical-slot events bound to <code>shipmentId</code> can. <strong>No size caps</strong> - replay refused nothing; now <code>≤256 hops / ≤4096 events</code> with a warn-logged refuse. <strong>Forwarded-IP trust</strong> - <code>X-Forwarded-For</code> shaped rate-limit buckets for any caller; now it requires <code>TRUST_PROXY_HEADERS=true</code>. <strong>Plan binding</strong> - a mismatched <code>terms.shipmentId</code> could still bind the plan's <code>client</code>; now the client binds only when terms are absent, silent, or matching. </p>

<h2>Why is the <code>limits</code> array inside the response?</h2>

<p> <strong>Short answer:</strong> because a verifiable view that doesn't declare its own boundaries pushes readers toward false conclusions. <code>limits</code> is the honesty contract - five machine-readable strings that travel with every response: linear hops only, manual settlement, evidence is advisory (not verified), the size caps, and the writer-trust boundary (status is lifted from canonical slots - writer authorization lives at the ledger layer, not the read path). </p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-verifiable-showcase-3.webp"
       alt="A brass museum plaque under the vitrine titled limits, engraved with five lines: linear hops only; manual settlement per hop; evidence is advisory - not verified (highlighted amber); caps ≤256 hops / ≤4096 events; status lifted from canonical slots - while a small robot agent polishes the brass" />
  <figcaption> The limits plaque. Declaring what the view does not promise is part of the API contract - the fifth line (writer trust at the ledger layer) names a boundary a later brick owns. </figcaption>
</figure>

<p> The subtle one is the last line. A public replay can prove <em>which events exist</em> and <em>what they claim</em> - it cannot prove <em>who was allowed to write them</em>. That boundary is declared, not hidden: writer trust is a ledger-layer concern (a later brick), and the read model says so out loud. "Evidence is advisory" is the Brick #2 boundary restated - <code>issuerMatchesParty</code> tells you the issuer's relationship to the parties, never whether the artifact itself is authentic. It is the same honesty as a lab report that prints its detection limits next to the result - the number means more when the instrument admits what it cannot see. </p>

<h2>How do you reuse the vitrine?</h2>

<p> <strong>Short answer:</strong> embed it. The response is a stable, closed-shape contract (<code>ShipmentReplayResponse</code> - the parser is the contract's own zod schema), cache-friendly on completion, honest on failure (400/404/503, never 200-with-error). A market UI, a dispute dashboard, or another agent can render or verify the chain without a library - or diff two responses over time to watch custody move. </p>

<p> For the rest of us the use cases are mundane and real: an insurer checking a cold-chain claim, a buyer opening a dispute, a freight marketplace rendering custody history before accepting a bid - none of them needs an account with us. </p>

<p> For builders, the replay code is <code>src/server/lib/econ-ledger/supply-chain/replay.ts</code>, the projection in <code>project.ts</code>, and the route in <code>econ-ledger-shipments-api.ts</code>. The audit regression file (<code>replay-audit.test.ts</code>) doubles as executable documentation of every hostile input we now refuse. And the demo chain above is one fixture call - <code>makeChain</code> from Brick #2's test suite drives the same lifecycle events a production shipment would. </p>

<p> Current state: <strong>16/16 audit regression tests, 84/84 targeted suite green</strong>, zero open Critical or High findings on the read path. The fix commit is <code>330f17a</code> (<code>fix(215-5)</code>); the per-finding resolution lives in the epic's review doc. </p>

<hr />

<h2>For AI Agents</h2>

<ul>
  <li><strong>What this proves:</strong> a composed transition chain is readable from the outside - <code>GET /api/ledger/shipments/:id</code> returns canonical replay state, per-hop claims with provenance (<code>*AssertedBy</code>, <code>issuerMatchesParty</code>), and its own <code>limits</code> - the sub-hypothesis "verifiability of transitions is public" holds on a real endpoint.</li>
  <li><strong>Live surface:</strong> <code>GET https://agentbadge.xyz/api/ledger/shipments/:id</code> - no auth; <code>404 not_found</code> unknown, <code>400 invalid_id</code> malformed, <code>503 unavailable</code> on store failure; completed responses cache 60s.</li>
  <li><strong>Reuse:</strong> response schema = <code>ShipmentReplayResponse</code> (closed shape, zod-validated); replay/projection code in <code>src/server/lib/econ-ledger/supply-chain/</code>; hostile-input contract in <code>tests/supply-chain/replay-audit.test.ts</code>.</li>
  <li><strong>Series:</strong> <a href="/blog/bedrij-principle">The Bedrij Principle</a> → <a href="/blog/supply-chain-participant-roles">Brick #1</a> → <a href="/blog/supply-chain-typed-evidence">Brick #2</a> → <a href="/blog/supply-chain-scenario-matrix">Brick #3</a> → this.</li>
</ul>

<p> Building agent-native supply chains? The ledger package is <code>@agentbadge/econ-events</code> on npm, and the anchor hypothesis this proves a piece of is in <a href="/blog/bedrij-principle">The Bedrij Principle</a>. </p>

<p><em>Don't certify. Measure.</em></p>
`;
