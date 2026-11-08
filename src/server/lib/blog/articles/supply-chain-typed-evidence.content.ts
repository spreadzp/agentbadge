/**
 * SLICE-213-6 · EPIC-162 C41 — Brick #2: Typed Evidence (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c41-typed-evidence/AgentBadge-Blog.md
 */
export const supplyChainTypedEvidenceContent = `
<p class="series-note">
  Part of the verifiable supply-chain series — start here:
  <a href="/blog/bedrij-principle">The Bedrij Principle</a>, then
  <a href="/blog/supply-chain-participant-roles">Brick #1: Typed Participants</a>.
  The hypothesis under test: a complex economic system can be composed from
  verifiable state transitions.
</p>

<p>
  A handoff event says <em>custody moved from 0xAA… to 0xBB…</em>. The natural
  next question is: <em>and where is the proof?</em> The temperature log, the
  GPS ping, the signed inspection photo, the weighbridge slip.
</p>

<p>
  Today that proof lives in an email thread, an S3 bucket, or a telematics
  dashboard someone copy-pastes into a dispute ticket. The transition is
  recorded — the evidence for it is scattered everywhere except next to the
  transition. And even when a link does make it into the data, a link is not a
  fact: it proves a pointer existed, not that what it points to is true.
</p>

<p>
  This is Brick #2 — the second experimental proof inside the Bedrij-series
  hypothesis. It proves a narrow claim: <em>evidence belongs to the
  transition.</em> Typed evidence references now travel inside the
  <code>handoff</code> event payload itself — the same append-only record that
  moves custody — and the replay model replays them with provenance
  annotations. One primitive, one payload, zero new endpoints.
</p>

<h2>What is typed evidence in a verifiable supply chain?</h2>

<p>
  <strong>Short answer:</strong> typed evidence is an optional list of
  references — <code>{type, hash, issuer, uri?}</code> — attached to a
  <code>handoff</code> event. <code>type</code> is one of seven values
  (<code>signature | gps | document | api_response | image | weight |
  temperature</code>), <code>hash</code> is a 0x-prefixed 32-byte digest of the
  artifact, <code>issuer</code> is the participant who claims the evidence, and
  <code>uri</code> is an optional pointer to the artifact itself. A handoff
  carries 1–32 refs; the replay read model lifts them into
  <code>hops[].evidence</code> per hop.
</p>

<p>
  The shape matters more than the fields. The <code>hash</code> binds the
  transition to <em>specific bytes</em> of proof — if the artifact changes, the
  hash stops matching. The <code>issuer</code> names who asserts the claim,
  using the same typed-participant shape Brick #1 introduced. And
  <code>uri</code> stays optional: the ledger records that proof was
  <em>referenced</em>, not that it was fetched — because fetching is a trust
  decision each consumer makes separately.
</p>

<h2>How does evidence travel through a handoff?</h2>

<p>
  <strong>Short answer:</strong> evidence enters at write time as
  <code>handoffHop(..., evidenceRefs)</code>, is validated by a strict write
  schema, rides inside the <code>handoff</code> event payload, and is lifted
  into <code>ShipmentHop.evidence</code> during replay — so
  <code>GET /api/ledger/shipments/:id</code> returns it per hop, annotated with
  <code>evidenceAssertedBy</code> (who attached it) and per-ref
  <code>issuerIsHopParty</code> (whether the issuer is one of the two parties
  in that hop).
</p>

<p>
  This is the actual replay output from our test pack — hop 0 carries a GPS
  ref issued by the receiving carrier, hop 1 carries none (addresses shortened
  for readability):
</p>

<pre><code class="language-json">{
  "shipmentId": "shp-ev-mixed",
  "hops": [
    {
      "hopIndex": 0,
      "status": "paid",
      "receiver": "0xbbbb…bbbb",
      "evidence": [
        {
          "type": "gps",
          "hash": "0xcdcd…cdcd",
          "issuer": { "address": "0xbbbb…bbbb", "type": "org" },
          "uri": "ipfs://QmGps",
          "issuerIsHopParty": true
        }
      ],
      "evidenceAssertedBy": "0xaaaa…aaaa"
    },
    {
      "hopIndex": 1,
      "status": "handed_off",
      "receiver": "0xdddd…dddd"
    }
  ]
}</code></pre>

<p>
  Three things worth reading in that JSON. <code>issuerIsHopParty: true</code>
  because the GPS issuer (<code>0xbbbb…</code>) <em>is</em> the counterparty
  taking custody — a hop party vouching for its own data is weaker evidence
  than an independent issuer would be, and the flag makes that distinction
  visible instead of hidden. <code>evidenceAssertedBy</code> is the client
  (<code>0xaaaa…</code>), not the carrier — the party doing the handoff
  attached the ref, and the projection records who did it. And hop 1 replays
  clean with no evidence fields at all: a mixed chain is not an error, evidence
  is per-transition data.
</p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-typed-evidence-d1.webp"
       alt="Diagram: the evidence lifecycle — handoffHop write with evidenceRefs, strict write schema, append-only handoff event, lenient replay, ShipmentHop.evidence plus issuerIsHopParty and evidenceAssertedBy, per-hop evidence in the shipments API" />
  <figcaption>
    The lifecycle of an evidence reference: asserted at write time by the party
    doing the handoff, validated by a strict schema, stored in the append-only
    log, then lifted by a lenient replay into per-hop state with two provenance
    annotations attached. Nothing in the read model pretends the artifact was
    fetched or verified — that stays the consumer's call.
  </figcaption>
</figure>

<h2>Why does a reference need provenance and guardrails?</h2>

<p>
  <strong>Short answer:</strong> because a reference with no provenance is a
  forgery primitive. Before the audit, any party could attach an evidence ref
  claiming it was issued by <em>anyone</em> — a fake "independent inspector"
  was indistinguishable from a real one. And the strict type/hash/URI rules
  existed only inside one server wrapper, so every other writer path got the
  lenient schema.
</p>

<p>
  We ran the deltas through an adversarial AI audit before shipping:
  <strong>0 Critical, 2 High, 7 Medium findings</strong>. The Highs were exactly
  the trust-boundary bugs: <strong>H-1</strong> — no persisted provenance and an
  inverted advisory (it warned on the honest case and stayed quiet on the
  forged one); <strong>H-2</strong> — strict validation lived in
  <code>parseHandoffEvidence</code> only, while the registered payload schema
  and the replay projection stayed lenient, so a forged event replayed into
  public state. Both are closed: <code>buildEconomicEvent</code> now validates
  handoff evidence on the write path by default, and replay annotates rather
  than trusts.
</p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-typed-evidence-2.webp"
       alt="Audit diagram: a forged issuer chip flagged by an amber advisory beacon that warns without blocking; strict write gate versus lenient read gate; canonical-sequence gate rejecting a forged event" />
  <figcaption>
    Forged-issuer claims hit an advisory, not a block — while the write path
    enforces the strict schema and replay gates claim-lifting on the canonical
    event sequence.
  </figcaption>
</figure>

<h2>What did the audit actually change in the code?</h2>

<p>
  <strong>Short answer:</strong> a write/read schema split, URI hardening, and
  three guardrails. <code>buildEconomicEvent(input, {mode})</code> defaults to
  strict write validation and offers <code>mode: "replay"</code> for stored
  events. Evidence URIs are allowlisted to <code>http(s)/ipfs/ar</code>, reject
  credentials and control characters, and canonicalize to
  <code>new URL(u).href</code>. The evidence list is pre-checked for
  cardinality (1–32) before per-item parsing, advisories are aggregated per
  write, and error echoes are bounded.
</p>

<p>
  The schema split follows the same rule Brick #1 learned:
  <strong>on an append-only log, the read contract can only grow more
  permissive.</strong> The <em>read</em> schema keeps an open evidence type — a
  future type added by a newer writer must not brick replay for older
  clients — while the <em>write</em> schema closes on the seven known types.
  The replay projection adds a belt on top: it <code>safeParse</code>s each
  stored payload and gates claim-lifting on the canonical event sequence, so a
  forged event with a well-formed payload but a wrong sequence number never
  lands in the public read model.
</p>

<p>
  Current state: <strong>118 package tests</strong> and
  <strong>35 supply-chain server tests</strong> green, zero open Critical/High
  findings, <code>@agentbadge/econ-events@0.1.3</code> published to npm. One
  finding was deliberately accepted rather than fixed: the hop lock is
  single-process — multi-instance deployments need a distributed lock,
  documented as a known limitation.
</p>

<h2>What evidence is NOT — the honest boundary</h2>

<p>
  <strong>Short answer:</strong> evidence is not truth, not verification, and
  not enforcement. A hash proves <em>these bytes existed</em>, not that they are
  accurate. An issuer is a self-declared identity — the same advisory layer
  Brick #1 established, not a registry lookup. A URI is fetched by nobody: the
  ledger stores the pointer, consumers decide whether to resolve it. And
  advisories are log warnings, not verdicts — a third-party issuer flags
  <code>issuerIsHopParty: false</code>; it does not block the handoff.
</p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-typed-evidence-3.webp"
       alt="Three stacked layers: reference (hash chip), provenance (asserted-by tag), and a dashed future verification layer labelled link is not fact" />
  <figcaption>
    Two layers are solid today: a hash that proves these bytes existed, and
    who attached it. Verification is the dashed layer that is not built yet —
    the ledger stores the pointer, not the proof.
  </figcaption>
</figure>

<p>
  That is deliberate. Brick #2 proves the <em>shape</em> of the claim —
  "evidence travels with the transition" — not the verification of the
  artifact. The interesting follow-ups are the missing layers: issuer
  registries, countersigned evidence (where the named issuer must consent),
  oracle attestations that verify the artifact itself, and on-chain anchors
  for the hash. Those are different bricks.
</p>

<p>
  If you're building agent-native supply chains: the schema package is
  <code>@agentbadge/econ-events</code>, the API is
  <code>GET /api/ledger/shipments/:id</code>, and the anchor hypothesis this
  proves a piece of is in
  <a href="/blog/bedrij-principle">The Bedrij Principle</a>, with the
  participant layer underneath it in
  <a href="/blog/supply-chain-participant-roles">Brick #1</a>.
</p>

<p class="closing"><em>Don't certify. Measure.</em></p>
`;
