/**
 * SLICE-214-6 · EPIC-162 C42 — Brick #3: Scenario Matrix (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c42-scenario-matrix/AgentBadge-Blog.md
 */
export const supplyChainScenarioMatrixContent = `
<p class="series-note">
  Part of the verifiable supply-chain series — start here:
  <a href="/blog/bedrij-principle">The Bedrij Principle</a>, then
  <a href="/blog/supply-chain-participant-roles">Brick #1: Typed Participants</a>
  and
  <a href="/blog/supply-chain-typed-evidence">Brick #2: Typed Evidence</a>.
  The hypothesis under test: a complex economic system can be composed from
  verifiable state transitions.
</p>

<p>
  A primitive that only works in demos is not a primitive. Before a
  supply-chain transition contract ever touches a testnet, you want to know
  exactly which violations it survives — and which it doesn't, yet.
</p>

<p>
  Bricks #1 and #2 built the happy path: typed participants and typed
  evidence travelling inside the handoff event itself. This brick goes the
  other direction. Instead of asking "does it work?", we asked "how does it
  break?" — seven scenarios, each one a violation a real chain will
  eventually see: undeclared telemetry, a rogue sensor, a missing inspection
  photo, a forged replay, a receiver dispute, a double settle racing the
  lock.
</p>

<p>
  This is Brick #3 — the third experimental proof in the Bedrij-series
  hypothesis, and the first that proves <em>resilience</em> rather than
  <em>shape</em>: <strong>the primitive has a regression contract.</strong>
  Every violation is exercised on an in-memory stack, its expected outcome
  is asserted, and after an adversarial AI audit found six real
  High-severity holes, every one of them got its own regression test.
</p>

<h2>What is a supply-chain scenario matrix?</h2>

<p>
  <strong>Short answer:</strong> a scenario matrix is a fixed set of
  end-to-end test scenarios — happy path plus violations — that run a
  shipment through the full lifecycle
  (<code>offer → handoff → settle → verify</code>) on an in-memory ledger and
  executor, then assert the replayed state and advisory flags. Ours is one
  file, <code>tests/supply-chain/scenario-matrix.test.ts</code>, 18 tests
  covering seven scenarios S1–S7 plus the audit hardening cases. Each
  scenario answers one question: <em>if this goes wrong, does the state
  machine stay honest?</em>
</p>

<p>
  The stack is deliberately boring. <code>makeChain()</code> — a shared
  fixture from Brick #2's audit — builds a shipment with N hops, typed
  roles, per-hop evidence, then drives
  <code>accept → handoff → settle → verify</code> on an
  <code>InMemoryHopExecutor</code> with deterministic job IDs. No chain, no
  RPC, no wall clock: the matrix replays the same events a production ledger
  would store, which is the point — the regression contract covers the
  <em>projection</em>, the part that turns an append-only log into answers
  like "who holds custody" and "is this hop paid".
</p>

<h2>What do the seven scenarios actually prove?</h2>

<p>
  <strong>Short answer:</strong> S1 proves the happy path end-to-end;
  S2–S5 prove each advisory flag fires on exactly the violation it names —
  and only there; S6 proves a receiver can halt the chain by disputing; S7
  proves payment is exactly-once under concurrency. Every assertion checks
  both the write payload and the replayed read model — a scenario that only
  verifies the call succeeded would prove nothing about the projection.
</p>

<table>
  <thead>
    <tr><th>Scenario</th><th>Violation</th><th>Expected outcome</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>S1</strong> happy path</td><td>none — 3-hop chain, declared device, party-issued telemetry</td><td>all hops <code>verified</code>, <strong>zero</strong> advisory flags</td></tr>
    <tr><td><strong>S2</strong> temp violation</td><td>temperature ref from a source that is neither a hop party nor the declared device</td><td><code>tempViolation</code> flag — settle still executes (advisory, not enforcement)</td></tr>
    <tr><td><strong>S3</strong> fake sensor</td><td>telemetry-typed ref whose issuer address ≠ declared <code>roles.device</code> — including an issuer claiming type <code>"org"</code></td><td><code>fakeSensor</code> flag; with no declared device the flag stays off (cannot judge → don't guess)</td></tr>
    <tr><td><strong>S4</strong> missing telemetry</td><td>a hop handoff carrying no evidence at all</td><td><code>missingEvidence</code> flag, chain remains valid</td></tr>
    <tr><td><strong>S5</strong> GPS anomaly</td><td>a <code>gps</code> ref from a non-party, non-device issuer</td><td><code>gpsAnomaly</code> flag; a party-issued GPS ref stays clean</td></tr>
    <tr><td><strong>S6</strong> receiver dispute</td><td>receiver rejects the handoff</td><td><code>disputed</code> flag, <code>settleHop</code> refuses while disputed, chain halts at that hop</td></tr>
    <tr><td><strong>S7</strong> double settle</td><td>two concurrent <code>settleHop</code> calls on the same hop</td><td>exactly-once: one executor call, one <code>pay</code> event — the loser queues on the per-hop lock</td></tr>
  </tbody>
</table>

<figure class="article-image">
  <img src="/images/blog/supply-chain-scenario-matrix-2.webp"
       alt="A seven-row scenario matrix table: S1 clean 3-hop → zero flags; S2 temp → tempViolation; S3 sensor → fakeSensor; S4 no evidence → missingEvidence; S5 gps → gpsAnomaly; S6 dispute → disputed; S7 double settle → exactly-once" />
  <figcaption>
    The matrix in one picture: seven scenarios, each mapped to the outcome
    the projection must produce. S1 and S7 assert invariants (zero flags,
    exactly-once); S2–S6 assert the named advisory flag fires — and only
    there.
  </figcaption>
</figure>

<p>
  Three details in that table matter more than the flags themselves.
</p>

<p>
  First, <strong>flags are advisory, never blocking</strong> — that's a
  decision, not an omission. S2's temperature violation does not hold the
  payment; it records that a violation was asserted. Automatic hold is a
  dispute-engine problem (a later brick), and pretending v1 enforces it
  would be a lie printed in our own docs.
</p>

<p>
  Second, <strong>S3 and S5 assert absences, not just presences.</strong> A
  scenario that only checks "the flag fired" is half a test — the audit
  showed exactly why (see below). Each violation scenario also proves the
  flag does <em>not</em> fire on the clean variant, and S1 genuinely
  exercises all five flags by giving the chain a declared device and real
  telemetry.
</p>

<p>
  Third, <strong>S7 proves contention, not just outcome.</strong> A naive
  exactly-once test asserts <code>settled.length === 1</code> after
  <code>Promise.all</code> — but if the lock never actually engaged, the
  test passes vacuously. Ours uses a deferred executor: while the winner is
  in-flight, we assert the loser is <em>queued</em> (executor unsettled,
  ledger unchanged), then release and assert one settle + one
  <code>pay</code> event.
</p>

<h2>What did the adversarial audit break?</h2>

<p>
  <strong>Short answer:</strong> we ran the whole matrix through an external
  adversarial AI audit before calling it done — verdict REQUEST CHANGES:
  <strong>0 Critical, 6 High, 7 Medium</strong>. The Highs were not style
  complaints: the projection trusted forged events, an
  <code>"inconclusive"</code> verdict silently promoted a hop to
  <code>verified</code>, <code>verifyHop</code> had no evaluator check or
  lock, and a concurrent <code>createShipment</code> could mint orphan
  funded jobs. All six are fixed with regression tests; three Mediums were
  deliberately accepted and documented instead of silently patched.
</p>

<p>
  The deepest finding — <strong>H-1</strong> — is the one worth remembering.
  The replay projection lifted state from <em>any</em> event with a
  well-formed payload: a <code>pay</code> event forged at sequence 41 for a
  non-plan hop index could mint a phantom paid hop, which then unlocked the
  next handoff. A fake handoff could even advance a hop's status without a
  single real delivery. The fix splits the projection into a two-pass,
  canonical-sequence replay: the plan binds to the
  <code>work_offer</code> at <code>seq === 1</code> (first writer wins —
  later offers can't redirect the payout target), and a handoff/pay/verify
  event lifts state only if it lands in the canonical sequence slot for its
  hop and stage, has an integer in-plan hop index, and is bound to the
  current <code>shipmentId</code>. A forged event now lifts
  <em>nothing</em> — not even status.
</p>

<figure class="article-image">
  <img src="/images/blog/supply-chain-scenario-matrix-3.webp"
       alt="A canonical-sequence gate wall: honest event chips labelled hop0..hop3 flow through matching seq slots into a shipmentState panel; forged chips labelled seq:99, hop:5, shp-OTHER bounce off into a rejected pool" />
  <figcaption>
    The H-1 fix: honest events enter through canonical sequence slots into
    the projected read model; forged events — wrong seq, out-of-plan hop
    index, or a different shipmentId — lift nothing, not even status.
  </figcaption>
</figure>

<p>
  The other Highs were subtler trust holes: <strong>H-2</strong> —
  <code>outcome:"inconclusive"</code> (or any unknown outcome) lifted a hop
  to terminal <code>verified</code>; now only an explicit
  <code>"pass"</code> promotes. <strong>H-3</strong> —
  <code>verifyHop</code> was a paid-gate only: any actor could write the
  verdict, and it bypassed every guard <code>disputeHop</code> had; now it
  runs inside the hop lock, refuses disputed hops, and requires the actor
  to be the evaluator (the next hop's receiver, or the client on the final
  hop). <strong>H-4</strong> — <code>createShipment</code> checked
  existence, created funded onchain jobs, then appended the offer with no
  lock — two concurrent calls could each create a funded job set; now the
  whole check→create→append is atomic under the shipment lock.
  <strong>H-5</strong> — a settle that succeeded onchain but failed to
  append to the ledger diverged silently; the error now carries the job ID
  loudly, and a regression test pins the visible divergence.
  <strong>H-6</strong> — S5's negative case and S1's "zero flags" assertion
  were vacuous: a GPS ref asserted by the very party it accused could never
  prove anomaly detection, and S1 had no declared device so
  <code>fakeSensor</code> could never even run. The tests were rebuilt to
  be non-vacuous.
</p>

<p>
  The Mediums we accepted are written down, not hidden: settle doesn't
  compare the caller-supplied amount against the plan (the onchain budget
  is the backstop — flagged for the hardening epic),
  <code>acceptShipment</code> is a decorative v1 marker, and all
  authorization is a caller-supplied actor string — fine inside the server,
  as long as HTTP routes derive actor from auth, which is now a documented
  boundary rule.
</p>

<h2>What does v1 NOT do — the honest boundary</h2>

<p>
  <strong>Short answer:</strong> the matrix proves the primitive's
  <em>state machine</em> is honest — it does not prove enforcement.
  Advisory flags warn and never block; disputes halt the chain only while
  the flag stands; the hop lock is single-process; and there is no
  per-source ledger ACL — the projection trusts that the ledger's writers
  are honest, which is a boundary the hardening epic owns.
</p>

<p>
  That honesty is the point of the exercise. A regression contract that
  claims more than the code does is worse than none — it's a false floor.
  The matrix instead pins exactly what v1 guarantees: canonical-sequence
  projection, evaluator-gated verification, pre-settle disputes, atomic
  shipment creation, exactly-once settle, and five advisory flags that fire
  on real violations and stay quiet on honest traffic.
</p>

<p>
  What's deliberately out of scope: issuer registries (who may call
  themselves a sensor), oracle attestations (verifying the artifact, not
  the reference), a real dispute engine with resolution outcomes,
  distributed locks for multi-instance deployment, and plan-amount binding
  for settle calls. Each is a named future brick, not a hidden gap.
</p>

<h2>How do you reuse the matrix?</h2>

<p>
  <strong>Short answer:</strong> the whole thing is one test file plus a
  fixture — <code>tests/supply-chain/scenario-matrix.test.ts</code> and
  <code>tests/supply-chain/helpers/chain-fixture.ts</code>.
  <code>makeChain({hops, roles, evidencePerHop, executor, lifecycle})</code>
  builds and drives any chain shape; <code>failOnSettleJobId</code> injects
  executor failures; the replay projection lives in
  <code>src/server/lib/econ-ledger/supply-chain/project.ts</code>. If you're
  building transition-contract primitives, the pattern copies over: one
  file of named violations, an in-memory executor, assertions on both
  write and replay.
</p>

<p>
  The matrix is also the reason the Bedrij hypothesis can keep stacking
  bricks. Brick #1 proved participants compose; Brick #2 proved evidence
  composes. Brick #3 proves the composition holds <em>under</em>
  violations — which is what makes the next layer (enforcement) a
  tractable problem instead of an open-ended one.
</p>

<p>
  Current state: <strong>72/72 supply-chain tests green</strong>, 18/18 in
  the matrix itself, zero open Critical or High audit findings. The audit
  report with per-finding resolution lives in the epic docs; the fix
  commit is <code>de2cf81</code> (<code>fix(214-5)</code>).
</p>

<p>
  If you're building agent-native supply chains: the ledger package is
  <code>@agentbadge/econ-events</code>, the read endpoint is
  <code>GET /api/ledger/shipments/:id</code>, and the anchor hypothesis
  this proves a piece of is in
  <a href="/blog/bedrij-principle">The Bedrij Principle</a>.
</p>

<p class="closing"><em>Don't certify. Measure.</em></p>
`;
