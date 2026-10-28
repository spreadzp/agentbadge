/** Article body for bedrij-principle (sections 01-08) — split for token-limit hook cap. */
export const bedrijPrincipleContentA = `<h2 id="strange-question">01 — The strange question</h2>
<p><strong>Short answer:</strong> supply chains fail at the joins, not the nodes. Every participant runs different systems — different APIs, databases, IoT devices, documents, authentication, business rules, payment rails — and the "supply chain" is really an integration graph that grows quadratically with every new participant.</p>
<p>A traditional picture looks linear:</p>
<pre><code>Manufacturer → Carrier → Warehouse → Distributor → Customer</code></pre>
<p>Technically, it is anything but. Each arrow is a bespoke project: custom EDI mappings, CSV exchanges over email, proprietary telematics, manual confirmation calls, invoice reconciliation. The work that makes a chain <em>work</em> is not the moving of goods — it is the constant translation between systems that were never designed to meet.</p>
<p>So the question isn't "which integration do we build next?" It's: <strong>is there a smaller question underneath all of them?</strong></p>

<h2 id="why-one">02 — Why "1"?</h2>
<p><strong>Short answer:</strong> because someone already asked a structurally identical question in a much harder domain. Orest Bedrij spent decades searching for a fundamental "1" — a single underlying principle from which the many phenomena of nature could be understood, predicted and verified.</p>
<p>Bedrij approached nature through a search for a fundamental "1". His published work — including a 2002 paper in the <em>Proceedings of the Institute of Mathematics of the National Academy of Sciences of Ukraine</em> — describes that "1" through what he called the Principle of the One-and-the-Many, built on fundamental constants and high-precision measurements.</p>
<p>We are not extending his physics, and we are not claiming his theory is established science. What we are doing is borrowing a question:</p>
<p><strong>Can complexity be composed from a sufficiently fundamental primitive?</strong></p>
<p>There is also a historical footnote that makes the rhyme hard to ignore. Bedrij was not only a theoretical thinker — he was a physicist and an investment banker, and per his Fetzer Institute biography, at age 29 he served as IBM's technical director on the computer complex behind the first soft landing on the Moon at NASA/JPL. Physics, computing, finance and philosophy on one résumé. Our version is narrower but rhymes: AI, software, cryptography, finance and physical supply chains.</p>
<p>The structural parallel is what earned him a place in this article:</p>
<pre><code>BEDRIJ                    AGENTBADGE
One                       One primitive
 ↓                         ↓
Many                      Many transitions
 ↓                         ↓
Relationships             Relationships
 ↓                         ↓
Measurement               Evidence
 ↓                         ↓
Verification              Verification</code></pre>
<p>We noticed a structural similarity in how the problem is posed. That is the whole claim — nothing more, and we think it's enough.</p>

<h2 id="our-question">03 — Our question</h2>
<p><strong>Short answer:</strong> what is the smallest useful unit of a supply chain? Not the shipment, not the participant, not the payment, not the API call — but something all of them are built from.</p>
<p>We went looking for the smallest unit that still does real work:</p>
<ul>
<li>It isn't a <strong>shipment</strong> — a shipment is a composition, not a unit.</li>
<li>It isn't a <strong>participant</strong> — participants don't move anything by existing.</li>
<li>It isn't a <strong>payment</strong> — payment is one consequence, not the event itself.</li>
<li>It isn't an <strong>API call</strong> — an API call is a transport detail.</li>
</ul>
<p>Our candidate is this: <strong>a transition whose result can be independently verified.</strong></p>
<pre><code>        State A
          │
          │  transition
          │
          ├── expected conditions
          ├── action
          ├── evidence
          ├── verification
          └── acceptance
          ↓
        State B</code></pre>
<p>That is our "1". Everything else in this article — and in the system — is composition.</p>

<h2 id="the-answer">04 — The answer</h2>
<p><strong>Short answer:</strong> a <em>verifiable state transition</em>. Not a transaction — a transition: a change in the state of the world whose preconditions, action, evidence, verification and acceptance are all explicit and checkable.</p>
<p>Why not "transaction"? Because the words we already have are all partial:</p>
<pre><code>Payment    ≠  Delivery
Delivery   ≠  Acceptance
Acceptance ≠  Proof
Proof      ≠  Settlement</code></pre>
<p>A transaction is a financial act. A supply chain is made of changes in the state of the world:</p>
<pre><code>PRODUCED → PACKED → DISPATCHED → IN TRANSIT → ARRIVED → INSPECTED → ACCEPTED</code></pre>
<p>Settlement is a <em>consequence</em> of certain transitions — not the essence of any of them. Once you see this, "paying for a shipment" stops looking like one event and starts looking like a chain of verified state changes, some of which happen to release money.</p>
<p><strong>Hypothesis: a complex economic system can be composed from verifiable state transitions.</strong></p>
<p>Supply chain is the first application. The agent economy is the horizon.</p>

<h2 id="transition-contract">05 — The transition contract</h2>
<p><strong>Short answer:</strong> each transition is governed by a <em>transition contract</em> — a small explicit agreement over what must be true before, what happens, what counts as proof, who verifies, and what follows.</p>
<pre><code>PRECONDITIONS
     ↓
ACTION
     ↓
EVIDENCE REQUIREMENTS
     ↓
VERIFICATION RULES
     ↓
ACCEPTANCE
     ↓
SETTLEMENT</code></pre>
<p>This is the term we will use throughout the series, and it carries the article's central sentence:</p>
<p><strong>A supply chain is not a sequence of transactions. It is a sequence of transition contracts.</strong></p>
<p>The transition contract is where a business rule actually lives. "Deliver 1,000 units at 2–8°C with the seal intact by 14:00" is not a paragraph in a PDF here — it is the preconditions and evidence requirements of one transition. If the evidence doesn't satisfy the rules, the state doesn't move, and nothing downstream — including money — fires.</p>
<p>In code, the whole idea fits in a type:</p>
<pre><code>type TransitionContract = {
  preconditions: Conditions;      // what must be true before
  action: Action;                 // what physically/logically happens
  evidenceRequired: Evidence[];   // what counts as proof
  verify: (e: Evidence[]) =&gt; Verdict;
  onAccept?: Settlement;          // what fires after acceptance
};</code></pre>
<p>One shape. Pharma cold chain, data delivery, a service performed by an agent — same contract, different contents.</p>

<h2 id="the-chain">06 — The chain</h2>
<p><strong>Short answer:</strong> compose transitions and you get a chain — <code>T₁ → T₂ → T₃ → T₄ → …</code> — of arbitrary length, where every link is independently verifiable and the protocol doesn't change as the chain grows.</p>
<pre><code>Manufacturer
     │
    T₁
     ↓
Carrier
     │
    T₂
     ↓
Warehouse
     │
    T₃
     ↓
Distributor
     │
    T₄
     ↓
Customer</code></pre>
<p>Every <code>Tₙ</code> expands the same way:</p>
<pre><code>Tₙ = Expected + Action + Evidence + Verification + Acceptance</code></pre>
<p>The chain can be four transitions or four hundred. No new participant needs a new <em>kind</em> of protocol — only new conditions, actions and evidence inside the same shape. That is the engineering content of "one primitive, arbitrary-length supply chains": the complexity lives in the configuration, not in the mechanism.</p>
<p>We deliberately say <em>arbitrary-length</em> inside the text, even though "infinite" sits in the title. The claim is composability, not magic.</p>

<h2 id="real-world">07 — The real world</h2>
<p><strong>Short answer:</strong> a supply chain happens outside software — trucks move, seals break, temperatures drift, machines produce parts. The model survives only if evidence can flow from physical reality into the transition, whatever produces it: IoT sensors, humans, machines, or agents.</p>
<pre><code>PHYSICAL WORLD
      │
      ↓
   OBSERVATION
      │
      ↓
    EVIDENCE
      │
      ↓
 CRYPTOGRAPHIC PROOF
      │
      ↓
   VERIFICATION
      │
      ↓
    NEW STATE
      │
      ↓
   SETTLEMENT</code></pre>
<p>Two architectural commitments follow.</p>
<p><strong>Evidence belongs to the transition, not the shipment.</strong> Evidence isn't metadata stapled to a container — it is a structural part of <code>Tₙ</code>, alongside conditions, action, verifier and result. A transition without its evidence is unfinished, not "a shipment with missing docs."</p>
<p><strong>The primitive is infrastructure-agnostic.</strong></p>
<pre><code>            VERIFIABLE TRANSITION
                    │
      ┌─────────────┼─────────────┐
      ↓             ↓             ↓
  Blockchain       IoT           AI
      │             │             │
  settlement     evidence      action</code></pre>
<p>A blockchain is one possible settlement and attestation rail — useful, verifiable, ours — but not a condition of the model. IoT is one possible evidence source. AI agents are one possible actor. Swap any of them and the transition contract still holds.</p>

<h2 id="economic-loop">08 — The economic loop</h2>
<p><strong>Short answer:</strong> proof triggers settlement, not the other way around. When verification passes and the receiver accepts, the economic consequence — escrow release — is a mechanical outcome of the transition, not a separate negotiation.</p>
<pre><code>proof → acceptance → settlement</code></pre>
<p>This inverts the usual instinct. Payment is not the foundation of trust in the chain; it is the last step of a verified transition. Money moves <em>because</em> a state change was proven, which is a very different thing from money moving and everyone hoping the state changed.</p>
<p>It also means the economic layer composes the same way the custody layer does: each <code>Tₙ</code> can carry its own settlement rule, and a long chain is just settlements firing in order as evidence accumulates.</p>`;
