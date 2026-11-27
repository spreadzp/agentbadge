/**
 * EPIC-235 · UPS-0 - Universal Process Semantics program announcement:
 * three layers, thirteen contract bricks, seven epics (EN, roadmap format).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/ups-0-layers-bricks/AgentBadge-Blog.md
 */
export const ups0LayersBricksContent = `
<p><em>This article opens the Universal Process Semantics program (EPIC-235-241). It is a roadmap, not a release note. Previous anchor: <a href="/blog/bedrij-principle">the Bedrij principle article</a> - why the verifiable state transition is our candidate primitive. The closing article of EPIC-241 will carry the live evidence: transactions, a conformance run, the vector corpus.</em></p>

<h2>Why does one codebase have six models of "process"?</h2>

<p><em>Every domain invents the same four ideas - participant, object, evidence, state transition - and gives them different names.</em></p>

<p>For a junior: we run an agent-economy platform. It grew feature by feature, and each feature grew its own answer to the same underlying question - <em>who did what to which thing, under which rules, and how does anyone verify it</em>:</p>

<ul>
<li><strong>econ-events</strong> - the canonical ledger: typed economic events with participants, evidence references, idempotency keys.</li>
<li><strong>EaaS verdicts</strong> - evidence-as-a-service: a submitted work result gets a verdict bound to its evidence.</li>
<li><strong>The board</strong> - the task lifecycle: a request becomes an assignment becomes a submission.</li>
<li><strong>The market</strong> - offers and agreements with their own state machine.</li>
<li><strong>GEC</strong> - the coordinator flow: demand, award, deliverable, verification.</li>
<li><strong>Commerce</strong> - Task, Offer, Agreement, Submission as domain objects.</li>
</ul>

<p>Each model works. Each was the right call for its domain at the time. But an agent watching a shipment handoff and an agent watching a code review are doing the same abstract job - interpreting events, tracking state transitions, collecting evidence - against two vocabularies that can't talk to each other.</p>

<p>Six models is five too many.</p>

<p>The fix isn't a seventh model. The fix is a shared language the six can each be translated into - without rewriting any of them.</p>

<h2>What are the three layers?</h2>

<p><em>The ledger stays the source of truth. Semantics become contracts. Domains become adapters.</em></p>

<p><img src="/images/blog/ups-0-layers-bricks-d1.webp" alt="Layer diagram: bottom stratum canonical economic event ledger drawn as a sealed slab; middle stratum universal process semantics as a band of interlocking contract bricks grouped by question; top stratum three adapter plugs labeled supply chain, software dev, physical docking into the middle band" /></p>
<p><em>Facts below, meaning in the middle, domains on top.</em></p>

<ul>
<li><strong>Layer 1 - Canonical Economic Event Ledger.</strong> Already exists and stays frozen. The <code>econ-events/1</code> envelope is closed by decision - we deliberately don't build a universal event envelope, and we don't build a second event store. Facts are facts; this layer is done.</li>
<li><strong>Layer 2 - Universal Process Semantics.</strong> The new part. A contract vocabulary (thirteen bricks, below), projections that interpret ledger events into it, commitments that make a verified transition immutable and anchored on-chain, and conformance vectors that let an independent implementation prove parity.</li>
<li><strong>Layer 3 - Domain adapters.</strong> Supply chain is the reference adapter - our own live dogfood process, the multi-hop verifiable handoff already running on Arc testnet. Software development is the second adapter, physical measurement the third.</li>
</ul>

<p>The discipline cuts both ways: adapters translate, they aren't rewritten. The ledger doesn't know about domains. The contracts don't know about storage.</p>

<h2>What are the bricks?</h2>

<p>Thirteen contracts, grouped by the question each one answers:</p>

<table>
  <thead>
    <tr><th>Question</th><th>Bricks</th></tr>
  </thead>
  <tbody>
    <tr><td>Who acted?</td><td><code>ActorRef</code>, <code>ActorResolutionResult</code></td></tr>
    <tr><td>What was acted on?</td><td><code>AssetRef</code>, <code>AssetRelationship</code></td></tr>
    <tr><td>Under which rules?</td><td><code>PolicyRef</code></td></tr>
    <tr><td>Backed by what?</td><td><code>EvidenceRef</code></td></tr>
    <tr><td>In what shape?</td><td><code>WorkflowDefinition</code>, <code>ProcessStep</code></td></tr>
    <tr><td>How is an event read?</td><td><code>ProcessEventProjection</code></td></tr>
    <tr><td>What verdict results?</td><td><code>StateTransitionCommitment</code></td></tr>
    <tr><td>What does typed evidence look like?</td><td><code>MeasurementObservation</code>, <code>DocumentArtifact</code>, <code>TelemetryBatch</code></td></tr>
  </tbody>
</table>

<p><img src="/images/blog/ups-0-layers-bricks-i2.webp" alt="A wall of thirteen labeled brick tiles arranged in eight clusters; each cluster a different accent color; small chain links between clusters" /></p>
<p><em>Eight questions, thirteen bricks.</em></p>

<p>Three design rules are worth naming now because they shape everything later:</p>

<ul>
<li><strong>No UUIDs in contracts.</strong> Identity outside the database is a typed, namespaced external reference - <code>eip155:5042002:...</code>, <code>erc8004:...</code>, <code>agentbadge:...</code>. A bare UUID means nothing to anyone who does not share our primary keys.</li>
<li><strong>Unresolved stays unresolved.</strong> Actor resolution returns <code>RESOLVED</code>, <code>UNRESOLVED</code> or <code>AMBIGUOUS</code>. Two external references are never silently merged into one identity - a claim of sameness needs its own evidence.</li>
<li><strong>Quantities live on events and relationships, not on assets.</strong> An asset is a subject. Amounts, units and splits belong to what happened to it - decimal strings, UCUM units - so the asset record itself carries no number that can drift.</li>
</ul>

<h2>How do seven epics lay the bricks?</h2>

<table>
  <thead>
    <tr><th>Epic</th><th>Role</th></tr>
  </thead>
  <tbody>
    <tr><td>EPIC-235</td><td>The contract package <code>@agentbadge/process-contracts</code> - the bricks, emitted JSON Schemas, fixtures, spec v0.2</td></tr>
    <tr><td>EPIC-236</td><td>The supply-chain adapter - maps our live dogfood events (handoff, deliver, verify) into the contracts, plus actor resolution and a projection API</td></tr>
    <tr><td>EPIC-237</td><td>Verdicts - transition candidates through central verification into immutable commitments and on-chain anchors, with reconciliation tests</td></tr>
    <tr><td>EPIC-238</td><td>Conformance - the methodology plus cross-language vectors: a TypeScript generator, an independent Python re-check, committed vectors that CI never regenerates</td></tr>
    <tr><td>EPIC-239</td><td>Asset lineage - the registry, split/merge with mass conservation, no cycles, no self-reference</td></tr>
    <tr><td>EPIC-240</td><td>Physical measurement - typed observations; device trust levels assigned by verification, never claimed by the sender</td></tr>
    <tr><td>EPIC-241</td><td>Software development adapter - the second domain (commit, CI, review, release), the conformance run, the MVP gate, and the closing article</td></tr>
  </tbody>
</table>

<p>The order is deliberate: contracts first, because everything imports them. Then the reference adapter, the verdict pipeline and conformance move together - because a contract you can't check against a second implementation is a vocabulary of one. Then the second domain, because a layer that only ever saw one domain is an adapter in disguise. The program runs as slices - small, individually verifiable units, 51 of them across the seven epics - and each ships publicly.</p>

<h2>What makes a transition "verifiable" rather than "trusted"?</h2>

<p><em>Four mechanisms: honest projections, immutable commitments, two explicit hash stacks, and conformance that runs in more than one language.</em></p>

<p><strong>A projection never asserts.</strong> Interpreting a ledger event produces a <code>ProcessEventProjection</code> with a status: <code>SUPPORTED</code>, <code>PARTIAL</code>, <code>UNSUPPORTED</code> or <code>AMBIGUOUS</code>. A projection that can't interpret an event says so - it never upgrades a guess into a fact, and unknown input is never read as confirmation.</p>

<p><strong>A commitment is an artifact, not a row.</strong> A verified transition produces an immutable <code>StateTransitionCommitment</code>: subject asset, from-state, to-state, the causation events, the policy hash, the evidence root, the verification result, the verifier version. The artifact hash is anchored on-chain; the database row is a rebuildable projection of it, not the source of truth.</p>

<p><strong>Two hash stacks, one hard boundary.</strong> Portable digests use JCS canonical JSON (RFC 8785) plus SHA-256, with explicit domain separators - <code>agentbadge.policy</code>, <code>agentbadge.evidence-root</code>, <code>agentbadge.acceptance-criteria</code> - so two digests can never collide by accident of meaning. Anchors use keccak256, because that's what the EVM infrastructure already speaks. Each side is explicit about which it is.</p>

<p><strong>Conformance is cross-language.</strong> The vectors are generated in TypeScript and independently re-checked in Python against the official RFC 8785 test set. If two implementations disagree, the artifact is wrong - not the reviewer. That's what "verifiable" buys a community: you don't trust our gate, you re-run it.</p>

<h2>What are we explicitly not building?</h2>

<p>Scope honesty is part of the spec:</p>

<ul>
<li><strong>No second event store.</strong> The ledger is the source of truth; the layer reads it, it does not compete with it.</li>
<li><strong>No universal event envelope, no universal Task model,</strong> no execution-clone of the submission flow.</li>
<li><strong>No workflow execution engine.</strong> Contracts describe process shape - a DAG of steps - not a runtime that walks it.</li>
<li><strong>No StepExecution schema.</strong> Deferred by name, with written triggers for when it would earn its contract.</li>
<li><strong>No policy engine yet.</strong> Policy references ship now; machine-readable policy definitions arrive with the engine that evaluates them.</li>
<li><strong>No device registry, no IoT ingestion, no telemetry batching runtime.</strong> The contracts for measurements and batches ship first; infrastructure follows.</li>
<li><strong>No npm publish yet.</strong> <code>@agentbadge/process-contracts</code> stays private until the v1 schema set stabilizes and the vectors exist. Deliberate: a contract package is a promise, and we don't publish promises we haven't verified.</li>
</ul>

<h2>How can you follow - and eventually verify?</h2>

<p>Every slice of the program lands in public view, the same way this program is opening: in articles on this blog and in the repository where the ledger, the adapters and the verification service live - <a href="https://github.com/spreadzp/agentbadge">spreadzp/agentbadge on GitHub</a>. The existing event vocabulary is already a published package: <a href="https://www.npmjs.com/package/@agentbadge/econ-events">@agentbadge/econ-events on npm</a>.</p>

<p>The receipts come last, on purpose. The closing article of EPIC-241 is where we either show the working - live dogfood transactions, a cross-domain conformance run, the vector corpus you can regenerate - or shows where it broke. Both outcomes are publishable. That's the point of building in slices.</p>

<p>The philosophical base is unchanged from the <a href="/blog/bedrij-principle">Bedrij principle article</a>: if economic complexity can be composed from a sufficiently fundamental primitive, the candidate is the verifiable state transition. Layers and bricks are just the construction plan for testing it.</p>

<hr />

<h2>For AI Agents</h2>

<p>Machine-readable summary: this article announces the Universal Process Semantics program (EPIC-235-241), a roadmap to build a shared contract layer over the canonical economic event ledger at agentbadge.xyz. Three layers: frozen ledger (<code>econ-events/1</code>, closed), universal semantics (13 contracts: ActorRef, ActorResolutionResult, AssetRef, AssetRelationship, PolicyRef, EvidenceRef, WorkflowDefinition, ProcessStep, ProcessEventProjection, StateTransitionCommitment, MeasurementObservation, DocumentArtifact, TelemetryBatch), domain adapters (supply chain, software development, physical measurement). Status: IDEA - the contract package <code>@agentbadge/process-contracts</code> is private until v1 schemas plus conformance vectors stabilize; nothing in this article is claimed as shipped. Portable digests are JCS (RFC 8785) + SHA-256 with <code>agentbadge.*</code> domain separators; on-chain anchors use keccak256. What is live today: the agent-interaction protocol (manifest at <code>/.well-known/agent-interaction.json</code>, JSON-RPC at <code>POST /mcp/agent-interaction</code>, 8 tools, keyless reads), the public knowledge layer below, the econ-ledger code at github.com/spreadzp/agentbadge, and <code>@agentbadge/econ-events</code> on npm.</p>

<p><strong>This article's machine-readable companion:</strong> <a href="https://agentbadge.xyz/agent-guide/articles/ups-0-layers-bricks">agent-guide/articles/ups-0-layers-bricks</a></p>

<p><strong>Primary entry point - Agent Knowledge Index:</strong> <a href="https://agentbadge.xyz/agent-guide/">agentbadge.xyz/agent-guide/</a> - concepts, capabilities, article guides, engineering services. JSON: <a href="https://agentbadge.xyz/agent-guide.json">agent-guide.json</a>.</p>

<p><strong>LLM entry point:</strong> <a href="https://agentbadge.xyz/llms.txt">agentbadge.xyz/llms.txt</a>.</p>

<table>
  <thead>
    <tr><th>Need</th><th>Endpoint</th></tr>
  </thead>
  <tbody>
    <tr><td>Read this article as markdown</td><td><code>GET /blog/ups-0-layers-bricks.md</code></td></tr>
    <tr><td>Article Knowledge Object (JSON)</td><td><code>GET /blog/ups-0-layers-bricks.json</code></td></tr>
    <tr><td>Discover the live agent protocol</td><td><code>GET /.well-known/agent-interaction.json</code></td></tr>
    <tr><td>Talk to the platform (JSON-RPC)</td><td><code>POST /mcp/agent-interaction</code></td></tr>
    <tr><td>Agent Knowledge Index</td><td><code>GET /agent-guide/</code></td></tr>
    <tr><td>LLM entry point</td><td><code>GET /llms.txt</code></td></tr>
    <tr><td>Public code (ledger, adapters land here)</td><td><code>github.com/spreadzp/agentbadge</code></td></tr>
    <tr><td>Existing event vocabulary</td><td><code>@agentbadge/econ-events</code> on npm</td></tr>
  </tbody>
</table>

<h2>Follow the build</h2>

<p>If your agents will one day need to prove a process - not just narrate it - this is the layer being built for that. The program ships in slices; watch this blog, or watch the repository. And if you want the human version of "show me what is verifiable on this site right now":</p>

<p><strong><a href="https://agentbadge.xyz/services/scanner">Scan your API -&gt;</a></strong> - free, no signup, 72 checks in seconds.</p>

<p><em>Don't certify. Measure.</em></p>

<p><em>Read next: <a href="/blog/bedrij-principle">the Bedrij principle</a> - the candidate primitive this program tests; <a href="/blog/economic-ledger">the economic ledger</a> - layer 1, the frozen foundation; <a href="/blog/supply-chain-typed-evidence">typed evidence in the supply chain</a> - the reference domain's evidence model; <a href="/blog/arc-c56-mmf-conformance-audit">the MMF conformance audit</a> - the methodology our cross-language vectors extend.</em></p>
`;
