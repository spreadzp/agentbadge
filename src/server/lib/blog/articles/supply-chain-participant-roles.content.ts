/** Article body for supply-chain-participant-roles (Brick #1, EPIC-212, C39). */
export const supplyChainParticipantRolesContent = `<p><em>Part of the verifiable supply-chain series — start here: <a href="/blog/bedrij-principle">The Bedrij Principle</a>. The hypothesis under test: a complex economic system can be composed from verifiable state transitions.</em></p>
<p>Here is the smallest broken thing in a supply chain: a <code>handoff</code> event that says <em>custody moved from 0xAA… to 0xBB…</em> — and nothing else.</p>
<p>Which of those addresses is a company? Which is a forklift's telematics unit, a dock-scheduling agent, a cold-chain probe? The ledger knows custody moved. It does not know <strong>who</strong> held the box — org, agent, or device. If the answer to that question lives only in somebody's spreadsheet, the chain of custody is verifiable and meaningless at the same time.</p>
<p>This is Brick #1 — the first experimental proof inside the Bedrij-series hypothesis. It proves a narrow claim: <em>transitions can be performed by nodes of any type, in a single primitive.</em> Orgs, agents and devices now travel the same <code>handoff</code> event, and the read model replays them with provenance. No new endpoint, no new contract — four optional slots on a payload that already existed.</p>
<img src="/images/blog/supply-chain-participant-roles-hero.webp?v=2" alt="The handoff: a package passing between an ORG building, a DEVICE robot arm and an AGENT glyph along an amber path" loading="lazy" />

<h2 id="what-are-participant-roles">What are participant roles in a verifiable supply chain?</h2>
<p><strong>Short answer:</strong> participant roles are optional, typed declarations of <em>who participated in a hop</em> — <code>{ custodian, operator, device, sensor }</code> — carried inside the <code>handoff</code> event payload and surfaced by the replay read model. Each role is an address, one of seven types (<code>org | agent | device | robot | drone | service | human</code>), and an optional display label. They are self-declared by the party doing the handoff — advisory metadata, not identity, and never consulted by any authorization or payment guard.</p>
<p>The distinction matters more than it looks. Our custody model is enforced by addresses: <code>counterparty</code> must equal the plan's receiver, <code>actor</code> must equal the current custody holder. Roles deliberately sit <em>above</em> that — they describe the real-world shape of the participants without pretending the chain verified it. A forklift can be listed as <code>device</code> and a scheduling service as <code>agent</code>; the ledger records who claimed it, not who approved it.</p>

<h2 id="how-roles-travel">How do roles travel through a handoff event?</h2>
<p><strong>Short answer:</strong> roles enter at write time (<code>handoffHop(…, roles)</code>), are validated by a strict write schema, ride inside the <code>handoff</code> event's payload, and are lifted into <code>ShipmentHop.roles</code> during replay — so <code>GET /api/ledger/shipments/:id</code> returns them per hop with <code>rolesAssertedBy</code> naming who made the claim. Events written before roles existed replay unchanged: every field is optional.</p>
<p>This is the actual replay output from our test pack — two hops, one with a company custodian plus device and sensor, one with a custodian and an agent operator (addresses shortened for readability):</p>
<pre><code>{
  "shipmentId": "shp-brick1-demo",
  "hops": [
    {
      "hopIndex": 0,
      "status": "paid",
      "receiver": "0xbbbb…bbbb",
      "roles": {
        "custodian": { "address": "0xbbbb…bbbb", "type": "org", "label": "TransMar Logistics" },
        "device": { "address": "0xcccc…cccc", "type": "device", "label": "Forklift-7 telematics" },
        "sensor": { "address": "0xdddd…dddd", "type": "device", "label": "Cold-chain probe" }
      },
      "rolesAssertedBy": "0xaaaa…aaaa"
    },
    {
      "hopIndex": 1,
      "status": "handed_off",
      "receiver": "0xeeee…eeee",
      "roles": {
        "custodian": { "address": "0xeeee…eeee", "type": "org", "label": "Eindhoven Cold Hub" },
        "operator": { "address": "0xcccc…cccc", "type": "agent", "label": "Dock-scheduler agent" }
      },
      "rolesAssertedBy": "0xbbbb…bbbb"
    }
  ]
}</code></pre>
<p>Three things worth reading in that JSON. The same address <code>0xcccc…</code> plays <code>device</code> on hop 0 and <code>agent</code> on hop 1 — a type is a claim about a role in <em>this</em> hop, not a global identity. <code>rolesAssertedBy</code> moves: the client asserted hop 0's roles, the carrier asserted hop 1's. And hop 1's handoff works even though hop 0 already settled — roles are per-transition data, not per-shipment configuration.</p>
<img src="/images/blog/arc-c39-supply-chain-roles-d1.webp" alt="Diagram: role lifecycle — handoffHop write with optional role slots → strict write schema → append-only handoff event → lenient replay → ShipmentHop.roles plus rolesAssertedBy → per-hop roles in the shipments API; guards never read roles" loading="lazy" />
<p><em>The lifecycle of a role claim: asserted at write time by the party doing the handoff, validated by a strict schema, stored in the append-only log, then lifted by a lenient replay into per-hop state — with rolesAssertedBy recording who made the claim. No guard ever consumes it: custody still answers only to counterparty and actor.</em></p>

<h2 id="why-provenance">Why do self-declared roles need provenance?</h2>
<p><strong>Short answer:</strong> because an unverified claim displayed as structured truth is indistinguishable from a verified one. A hander-off could label any third party "Maersk" and a consumer reading only <code>hops[].roles</code> would never know it was self-reported. We fixed that by writing the <em>asserting party</em> into the derived model — <code>rolesAssertedBy</code> — and by enforcing that <code>custodian.address</code> must equal the handoff <code>counterparty</code>, since custodian is the slot whose meaning the ledger already defines.</p>
<p>That fix came from an adversarial review, not foresight. We ran the changes through an AI audit before shipping: <strong>0 Critical, 4 High, 6 Medium findings</strong> on the first pass. The Highs were exactly the trust-boundary bugs you'd want caught — roles presented as structured truth with no provenance (H-1), <code>custodian</code> able to contradict the custody model (H-2), a repeat handoff silently rewriting roles (H-3), and an <code>epcis</code> object able to smuggle keys that overrode guarded payload fields (H-4). All four are now guarded, and the re-audit came back <strong>APPROVE WITH NITS</strong>.</p>
<img src="/images/blog/supply-chain-participant-roles-2.webp?v=2" alt="Schema card: a handoff event envelope with four role slots — custodian, operator, device, sensor — and seven type chips below; the custodian slot links to counterparty" loading="lazy" />

<h2 id="what-the-audit-changed">What did the audit actually change in the code?</h2>
<p><strong>Short answer:</strong> four behavioral changes and a schema split. Write-side parsing is now strict — unknown role slots or keys fail loudly instead of silently stripping; addresses normalize to lowercase; <code>label</code> rejects control, bidi and zero-width characters and must be non-blank; <code>custodian</code> must equal the counterparty; a hop already handed off rejects re-handoff; and the payload's guarded fields (<code>shipmentId</code>, <code>hopIndex</code>) are written last so a caller-supplied object can't overwrite them. The read schema stays lenient — stored events always replay.</p>
<p>The schema split is the part I'd highlight for anyone building on append-only logs: the <em>write</em> schema and the <em>read</em> schema are now different objects. <code>ParticipantRolesWriteSchema</code> is strict (<code>z.strictObject</code>, normalization, consistency refines). <code>ParticipantRoleSchema</code> — the one inside <code>HandoffPayloadSchema</code> and <code>ShipmentHopSchema</code> — is deliberately lenient, because tightening a rule tomorrow must never make a stored event unparseable. An append-only log means your read contract can only grow more permissive over time.</p>
<p>Current state: 76 package tests and 40 server tests green, zero open Critical/High findings, two audit reports committed alongside the code.</p>
<img src="/images/blog/supply-chain-participant-roles-3.webp?v=2" alt="Audit loop: an AI-auditor glyph raising H-1..H-4 findings on the left; the same ledger behind guard rails stamped APPROVE on the right" loading="lazy" />

<h2 id="honest-boundary">What roles are NOT — the honest boundary</h2>
<p><strong>Short answer:</strong> roles are not a registry, not a delegation mechanism, and not a signature scheme. Nothing checks that "Eindhoven Cold Hub" is who it says it is; <code>rolesAssertedBy</code> is only as strong as the authentication on the write path; <code>label</code> is display text and a determined attacker can still craft look-alike strings. If your application needs <em>verified</em> participant identity, roles are the wrong layer — they're the substrate such a verification layer would annotate.</p>
<p>That's deliberate. Brick #1 proves the <em>shape</em> of the claim — "transitions can name nodes of any type" — not the verification of the claim. The interesting follow-ups are exactly the missing layers: a participant registry, countersigned roles (where the named party must consent), and device attestations. Those are different bricks.</p>

<h2 id="for-ai-agents">For AI Agents</h2>
<pre><code>{
  "what": "Typed participant roles (custodian/operator/device/sensor) on handoff events in an append-only economic ledger, replayed into per-hop read state with provenance.",
  "where": "packages/econ-events (ParticipantRoleSchema, ParticipantRolesSchema, ParticipantRolesWriteSchema); hackathon/server supply-chain pack (handoffHop, shipmentState); GET /api/ledger/shipments/:id",
  "contract": "roles optional at every level; write path strict (unknown keys reject, addresses lowercase, custodian == counterparty, one type per address); read path lenient",
  "verify": "76 package + 40 server tests green; adversarial AI audit REQUEST CHANGES → fixes → re-audit APPROVE WITH NITS; findings + fixes committed",
  "limits": "roles are self-declared, not verified identity; single-process hop lock; labels are display-only"
}</code></pre>
<p>If you're building agent-native supply chains: the schema package is <code>@agentbadge/econ-events</code>, the API is <code>GET /api/ledger/shipments/:id</code>, and the design docs for this brick live in <code>docs/EPICS/212-supply-chain-participant-roles/</code>. The anchor hypothesis this proves a piece of is in <a href="/blog/bedrij-principle">The Bedrij Principle</a>.</p>
<p><em>Don't certify. Measure.</em></p>`;
