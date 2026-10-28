/** Article body for bedrij-principle (sections 09-15) — split for token-limit hook cap. */
export const bedrijPrincipleContentB = `<h2 id="real-shipment">09 — A real shipment</h2>
<p><strong>Short answer:</strong> here's the whole idea as configuration. A pharma shipment — 1,000 units, cold chain, sealed, deadline — written once as a spec, executed as transitions.</p>
<pre><code>{
  "shipmentId": "SHIP-001",
  "hops": [
    {
      "from": "manufacturer",
      "to": "carrier",
      "work": "pickup",
      "conditions": {
        "quantity": 1000,
        "temperature": [2, 8],
        "seal": "intact"
      }
    },
    {
      "from": "carrier",
      "to": "warehouse",
      "work": "delivery",
      "conditions": {
        "temperature": [2, 8],
        "deadline": "14:00"
      }
    }
  ]
}</code></pre>
<p><strong>The chain becomes data.</strong> An arbitrary supply chain is not a hard-coded workflow — it is configuration plus rules plus evidence plus transitions.</p>
<p>And on the wire, the transitions are ordinary, inspectable events:</p>
<pre><code>work_offer
    ↓
handoff
    ↓
pay
    ↓
verify
    ↓
work_offer   ← next hop
    ↓
handoff
    ↓
pay
    ↓
verify</code></pre>
<p>Each loop is one transition contract executing: terms offered, custody handed off, escrow released, outcome verified. Repeat per hop until the goods reach the end of the chain.</p>
<p><img src="/images/blog/bedrij-principle-2.webp" alt="The Verifiable State Transition: State A through expected, action, evidence, verification and acceptance to State B" /></p>

<h2 id="built">10 — What we have built</h2>
<p><strong>Short answer:</strong> a working v0.1 of exactly this model — an append-only economic ledger with a supply-chain pack where a shipment is a linear sequence of hops, each hop escrowed, and ordering enforced by re-deriving state from the event log.</p>
<p>This is not a philosophical fantasy. The code exists and runs. But honesty matters more than enthusiasm, so here is the real status table rather than a highlights reel:</p>
<table>
<thead><tr><th>Layer</th><th>v0.1</th></tr></thead>
<tbody>
<tr><td>Shipment</td><td>linear hops</td></tr>
<tr><td>Ledger</td><td>append-only</td></tr>
<tr><td>Handoff</td><td>event</td></tr>
<tr><td>Verification</td><td>manual evaluator</td></tr>
<tr><td>Evidence</td><td>advisory / typed refs</td></tr>
<tr><td>Escrow</td><td>per-hop</td></tr>
<tr><td>Ordering</td><td>enforced</td></tr>
<tr><td>Replay</td><td>event-derived</td></tr>
<tr><td>Multi-hop</td><td>working</td></tr>
<tr><td>Automated evidence evaluation</td><td>announced</td></tr>
<tr><td>Live testnet</td><td>announced</td></tr>
</tbody>
</table>
<p>The ordering guarantee is worth spelling out, because it is the transition contract doing real work: hop <em>i+1</em> cannot hand off until hop <em>i</em> is paid — the guard re-derives state from the log and throws <code>ShipmentOrderError</code> rather than trusting a flag. Try to settle a hop that was never handed off, same refusal. No evidence, no money.</p>
<p>What is deliberately <em>not</em> there yet: evidence is advisory (typed references, not automated evaluation), and verification is a manual evaluator — a human or delegated agent acting as a risk gate before each settlement. Auto-settlement is intentionally deferred: money moves once, and a manual gate is the last line of defense while the system is young.</p>

<h2 id="next">11 — What we are building next</h2>
<p><strong>Short answer:</strong> five experimental bricks, each designed to prove one part of the hypothesis — participant roles (212), typed evidence (213), a scenario matrix (214), a replay view (215), and a live onchain dogfood (216). Each gets its own article; this one is the anchor.</p>
<ul>
<li><strong>Roles</strong> — the handoff carries who is acting, so a "node" can be any participant type: company, warehouse, device, agent.</li>
<li><strong>Evidence</strong> — <code>evidence[]</code> typed references on transitions, so proof has structure instead of being a hash-string hope.</li>
<li><strong>Scenario matrix</strong> — a regression suite of realistic chain shapes that must keep passing as the model grows.</li>
<li><strong>Replay view</strong> — <code>GET /shipments/:id</code> rebuilt from the event log, so any party can replay the custody story.</li>
<li><strong>Live dogfood</strong> — a real multi-hop shipment settled on testnet, with transaction hashes attached to this article after the fact.</li>
</ul>
<p>None of these are feature announcements. They are experiments against parts of the hypothesis: can roles, evidence, ordering, replay and live settlement each hold inside the same primitive? The series reads as one investigation — this article is the frame, the bricks are the measurements.</p>

<h2 id="readiness-to-economy">12 — From readiness to economy</h2>
<p><strong>Short answer:</strong> this experiment is the continuation of a line AgentBadge has been on since the first article. Readiness asked <em>can an agent use your system?</em> — the transition contract asks <em>can we verify what it did, and settle on it?</em></p>
<pre><code>READINESS      can an agent use it?
   ↓
ACTION         can it act?
   ↓
EVIDENCE       can the act be proven?
   ↓
TRUST          can we verify what it did?
   ↓
SETTLEMENT     can verified action trigger value?</code></pre>
<p>Agent Readiness measured whether an agent could find, understand and call a system. The supply-chain work measures what happens <em>after</em> — whether the action produced a verifiable result that justifies an economic consequence. Same methodology — evidence, assertions, verification — applied one level up, where the thing being verified isn't an API surface but a change in the world.</p>

<h2 id="thesis">13 — The thesis</h2>
<p><strong>Short answer:</strong> trust isn't a score. Trust is a sequence of verified transitions.</p>
<p>A score compresses history into a number and asks you to believe the compression. A sequence of verified transitions does the opposite: it keeps every step inspectable, and lets anyone re-derive the outcome from the events. You don't have to trust the chain — you can replay it.</p>
<p>That reframes what we've been building toward. The deeper thesis of this series:</p>
<p><strong>We are not trying to make trust universal by standardizing every workflow. We are trying to make trust composable by standardizing the smallest verifiable transition.</strong></p>
<p>Agents can't rely on trust as a feeling. They need trust as a verifiable state. That is what the transition contract supplies — and why the primitive, not the pipeline, is the thing worth getting right.</p>

<h2 id="open-question">14 — A question left open</h2>
<p><strong>Short answer:</strong> we don't know if the primitive is final. What we know is the composition ladder it enables — and that the first rungs already execute.</p>
<pre><code>One transition
      ↓
A chain
      ↓
A network
      ↓
A market
      ↓
An agent economy</code></pre>
<p>If nature can be approached through relationships emerging from something as simple as "1" — that was Bedrij's bet, whatever one thinks of his physics — then perhaps economic systems can be designed from a small number of universal primitives. Our first candidate is the verifiable state transition.</p>
<p>We are not claiming the answer is proven. We are claiming the question is now executable: each brick either holds inside the primitive or teaches us where it breaks.</p>
<p><strong>The experiment has started.</strong></p>
<p><img src="/images/blog/bedrij-principle-3.webp" alt="From One Transition to an Economy: transition composing into chain, network, market and agent economy" /></p>

<h2 id="for-agents">For AI agents</h2>
<p>If you are an agent reading this: the machine-readable contract behind this article is live. A transition is a typed event — <code>work_offer</code>, <code>handoff</code>, <code>pay</code>, <code>verify</code> — appended to an append-only ledger; a shipment's state is derived by replaying its events, never asserted. Ordering is enforced (<code>ShipmentOrderError</code> on out-of-order hops), escrow is per-hop, and settlement follows verified acceptance. The companion markdown version of this post is at <code>/blog/bedrij-principle.md</code>; the economic-ledger APIs this model runs on are documented in the <a href="/blog/economic-ledger">economic ledger article</a> and the <a href="/agent-guide/articles/bedrij-principle">agent guide</a>. The primitive is infrastructure-agnostic — you can produce evidence, verify transitions and trigger settlement without a human in the loop. The only thing you can't do is skip the evidence.</p>

<h2 id="note-on-bedrij">15 — A note on Bedrij</h2>
<p>The reference to Orest Bedrij in this article is intellectual inspiration, not a scientific claim. We name this exploration <em>the Bedrij Principle</em> because his search for a fundamental "1" — described in his published work through the One-and-the-Many principle and a program of prediction, validation and high-precision measurement — provides an unusually useful lens for thinking about composable systems. We are not extending his physics, not validating his theory, and not claiming established science. What we borrowed is a question: can complexity be composed from a sufficiently fundamental primitive?</p>
<p><em>Footnote-level discovery, for the curious: while researching this idea we found a Ukrainian publishing connection — the National Library of Ukraine catalog holds two Bedrij editions: a Kyiv 2014 edition of</em> '1' <em>itself (Companion Group, 113 pp.) and a 2018 Ukrainian translation of</em> The Greatest Achievement <em>(Art Ekonomi, 216 pp., trans. N. Olenin).</em></p>
<p>Verified sources for sections 02 and 15: O. Bedrij, <em>New Relationships and Measurements for Gravity Physics</em>, Proceedings of the Institute of Mathematics of NAS of Ukraine, 2002, Vol. 43, Part 2, pp. 589–601 (<a href="https://imath.kiev.ua/~symmetry/Symmetry2001/Bedrij589-601.pdf">imath.kiev.ua</a>; <a href="https://inspirehep.net/literature/580870">INSPIRE 580870</a>); <em>'1': The Ultimate Foundation of Nature</em>, Xlibris, 2015, ISBN 9781503590526; <a href="https://fetzer.org/trustee-history">Fetzer Institute trustee history</a>; National Library of Ukraine catalog (<a href="http://orf.nlu.org.ua">orf.nlu.org.ua</a>).</p>

<hr />
<p><em>This is the anchor article for the AgentBadge supply-chain series. Next: participant roles — what it takes for a company, a device, or an agent to be "a node" in the chain. Have a supply chain worth testing against the primitive? <a href="/contact">Tell us about it</a>.</em></p>
<p><em>Don't certify. Measure.</em></p>`;
