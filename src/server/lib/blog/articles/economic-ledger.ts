import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "economic-ledger",
  title: "We Gave Our Agent Economy a Ledger. Then We Made an AI Audit It.",
  description:
    "An append-only event log turns scattered payment hashes into a queryable agent economy: canonical events (offer, accept, handoff, pay, verify), trust edges derived from the log, an advisory exposure endpoint, and a three-hop supply-chain dogfood where one escrow job rides each hop. Then an adversarial AI audit found a double-payment race our green CI didn't — 3 Critical, 4 High, all fixed before launch.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-25",
  dateModified: "2026-10-25",
  tags: [
    "economic-ledger",
    "agent-economy",
    "supply-chain",
    "erc-8183",
    "x402",
    "trust-edges",
    "ai-audit",
    "arc",
    "event-sourcing",
  ],
  readingTime: "8 min",
  shortAnswer:
    "An append-only event ledger (offer, accept, handoff, pay, verify) makes our agent economy queryable: trust edges derive from the log, exposure reads stay advisory, a 3-hop shipment dogfoods escrow-per-hop. An AI audit found a double-pay race — all Critical/High fixed.",
  heroImage: "/images/blog/economic-ledger-hero.webp",
  ogImage: "/images/blog/economic-ledger-og.jpeg",
  status: "LIVE",
  technologies: [
    "Bun",
    "TypeScript",
    "Postgres",
    "Hono",
    "ERC-8183",
    "x402",
    "viem",
    "Zod",
  ],
  entities: [
    "econ-ledger-store",
    "supply-chain-pack",
    "trust-edge-projection",
    "econ-events",
    "erc-8183-hop-executor",
    "arc-studio-audit",
  ],
  concepts: [
    "append-only-ledger",
    "derive-dont-believe",
    "canonical-event-kinds",
    "hop-ordered-custody",
    "advisory-not-enforcement",
    "honest-no-data",
    "toctou",
  ],
  topics: ["agent-economy", "economic-ledger", "supply-chain", "money-safety", "ai-audit"],
  capabilities: [
    "ledger-event-append",
    "trust-edge-derivation",
    "advisory-exposure-scoring",
    "hop-gated-settlement",
    "shipment-state-read",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/economic-ledger.md",
    },
    {
      type: "read",
      label: "Shipment read endpoint",
      url: "https://agentbadge.xyz/api/ledger/shipments/demo",
    },
    {
      type: "read",
      label: "Agent Guide",
      url: "https://agentbadge.xyz/agent-guide",
    },
    {
      type: "contact",
      label: "Work with AgentBadge",
      url: "https://agentbadge.xyz/agent-guide/team/contact",
    },
  ],
  qa: [
    {
      question: "Why does an agent economy need its own ledger?",
      answer:
        "Onchain transfers prove value moved but carry no story — a 10 USDC hash could be hop 2 of a shipment or spam. A ledger of canonical events (offer, accept, handoff, pay, verify) with actor, counterparty, amount, and payload makes the economy queryable instead of guessable, and the log — not API input — is the source of truth.",
    },
    {
      question: "How do trust edges get derived instead of collected?",
      answer:
        "Every pay event asserts 'A paid B'. Enough events aggregate into a trust edge — eventCount, totalUsdc, firstAt/lastAt, recency-weighted — as a pure function of the log. Delete the edge table, replay the events, get the same answer: the trust graph is a provably regenerable cache, and disputes argue about events, not vibes.",
    },
    {
      question: "What did the adversarial audit find in the supply-chain pack?",
      answer:
        "REQUEST CHANGES — 3 Critical, 4 High, 6 Medium. Worst: a TOCTOU where two concurrent settle calls both pass the 'not yet paid' guard and pay the same hop twice; a silently dropped amountUsdc parameter that TypeScript's excess-parameter rule hid; and a caller-supplied receiver never checked against the offer terms. All Critical/High fixed and re-verified before any funded run.",
    },
    {
      question: "How does hop ordering work in the supply-chain pack?",
      answer:
        "One ERC-8183 escrow job per hop; hop i's evaluator is hop i+1's receiver. Handoff of hop N+1 throws unless hop N is paid; settle throws unless the hop's own handoff evidence exists. Guards re-derive state from the event stream on every call — order is enforced by the log, not by flags.",
    },
    {
      question: "Is the exposure score a gate for payments?",
      answer:
        "No — it is advisory by design. GET /api/ledger/agents/:address/exposure returns a score plus named reasons, and returns dataQuality: 'insufficient' with a null recommendation when the file is thin. It publishes evidence for a policy decision; it does not block.",
    },
  ],
  claims: [
    {
      id: "c37-hop-order-enforced",
      status: "VERIFIED",
      text: "Hop N+1 cannot hand off until hop N is paid, and settle is refused without handoff evidence — ordering is derived from the shipment's own event stream on every call.",
      evidence: [
        { type: "test", url: "https://github.com/spreadzp/agentbadge/blob/main/tests/econ-ledger-shipment.test.ts" },
      ],
    },
    {
      id: "c37-audit-request-changes",
      status: "VERIFIED",
      text: "Arc Studio adversarial review returned REQUEST CHANGES with 3 Critical, 4 High, 6 Medium findings — including a TOCTOU double-settle and a silently dropped settle amount; all Critical/High were fixed and re-verified.",
      evidence: [
        { type: "test", url: "https://github.com/spreadzp/agentbadge/blob/main/tests/econ-ledger-shipment.test.ts" },
      ],
    },
    {
      id: "c37-settle-lock",
      status: "VERIFIED",
      text: "A per-(shipmentId, hopIndex) async lock serializes the guard→settle→append triple so concurrent requests cannot both pass the unpaid check; multi-instance deploys escalate to a Postgres advisory lock.",
      evidence: [
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/state.ts" },
      ],
    },
    {
      id: "c37-ledger-tests",
      status: "VERIFIED",
      text: "Test suites on the fixed code: 8/8 shipment e2e (including injected settle failure preserving the log), 16/16 ledger API, 30/30 database, 52/52 econ-events.",
      evidence: [
        { type: "test", url: "https://github.com/spreadzp/agentbadge/blob/main/tests/econ-ledger-shipment.test.ts" },
      ],
    },
    {
      id: "c37-prod-executor-not-live",
      status: "UNVERIFIED",
      text: "The production Erc8183HopExecutor is composed from proven primitives but has not settled a funded hop on testnet; the dogfood runs an in-memory executor on the same contract.",
      evidence: [],
    },
  ],
  content: `<h2 id="why-ledger">Why does an agent economy need its own ledger?</h2>
<p><strong>Short answer:</strong> onchain transfers prove value moved, but nothing on the chain knows <em>why</em>. Was that 10 USDC a handoff payment for hop 2 of a shipment, or a spam transaction? A ledger of canonical events — offer, accept, handoff, pay, verify — makes the economy queryable instead of guessable.</p>
<p>Agents on our platform already pay each other — x402 for reads, ERC-8183 escrow for work. Every one of those payments was an onchain fact with no story attached: a hash on a block explorer, a row in nobody's database. Ask a simple question — <em>"who has agent X actually paid, and did the work happen?"</em> — and the honest answer was "go grep four different sources."</p>
<p>So we keep the fix deliberately boring: five event kinds, one source tag per domain, one correlation id per workflow. Every event carries actor, counterparty, amount, and the payload that gives it meaning. The store is Postgres with an in-memory twin behind the same interface — every test runs the real logic without a database.</p>
<p>The design rule that matters most: <strong>the ledger is the source of truth, not the API caller.</strong> You can't POST a shipment into state — you can only append events, and every derived view re-reads the log.</p>

<h2 id="derive">How do you get trust edges without asking anyone to trust you?</h2>
<p><strong>Short answer:</strong> you don't collect claims — you derive them. Every <code>pay</code> event says <em>"A paid B for something."</em> Enough of those and you get a trust edge: A and B transacted N times for $M total, weighted by recency and rail mix. No reputation oracle, no self-reported ratings.</p>
<p>This is the part we like most about the append-only model. An edge is a pure function of the log:</p>
<pre><code>// GET /api/ledger/pairs/:a/:b — derived, replayable
{ "edge": { "eventCount": 14, "totalUsdc": "61.5",
            "firstAt": "…", "lastAt": "…" } }</code></pre>
<p>Delete the edge table, replay the events, get the same answer. If someone disputes a relationship, the dispute is about <em>events</em> — each of which has a txHash, a rail, and an amount — not about vibes. That's what "derive, don't believe" means in practice: the trust graph is a cache, and the cache is provably regenerable.</p>
<p><img src="/images/blog/economic-ledger-2.webp" alt="Event waterfall becomes a trust edge: derive, don't believe" /></p>

<h2 id="exposure">Can an agent check exposure before paying a counterparty?</h2>
<p><strong>Short answer:</strong> yes — <code>GET /api/ledger/agents/:address/exposure</code> returns an advisory score built from pair history, forensics verdicts, and wallet spend context. When data is thin it returns an honest <code>insufficient</code> instead of a confident guess.</p>
<p>Two rules keep it honest. First, it's <strong>advisory</strong>: the endpoint answers "should I be careful" with a score plus named reasons — never "should I block." Blocking is a policy decision; we publish evidence. Second, <strong>thin files say so</strong>. Fewer than the minimum events, no forensics coverage, and the response is <code>dataQuality: "insufficient"</code> with <code>recommendation: null</code>. A tool that pretends certainty it doesn't have is worse than no tool.</p>

<h2 id="shipment">What does a three-hop shipment look like as ledger events?</h2>
<p><strong>Short answer:</strong> one shipment = one offer + a chain of per-hop accept → handoff → pay → verify events, with one ERC-8183 escrow job per hop. Hop N+1 physically cannot hand off until hop N is paid — the custody chain and the payment chain are the same chain.</p>
<p>Our dogfood scenario is the classic custody story: factory → carrier → warehouse → last-mile. <code>createShipment</code> emits the offer and creates one escrow job per hop, where hop <em>i</em>'s evaluator is hop <em>i+1</em>'s receiver — the next custody holder is the one who verifies. Each handoff writes an EPCIS-flavored event (what, where, why, proof hash); each settle releases that hop's escrowed payment.</p>
<p>The ordering guard isn't a flag in a row — it re-derives state from the log every time. Try to hand off hop 2 while hop 1 is unpaid and the function throws <code>hop 2 blocked: hop 1 is "handed_off", must be paid first</code>. Try to settle a hop that was never handed off, same thing — no evidence, no money. And when we inject a settle failure mid-chain, the events that did land stay: the log survives the failure, which is the whole point of appending facts instead of overwriting state.</p>
<p><code>GET /api/ledger/shipments/:id</code> returns the whole thing — hop statuses plus the raw event stream — so any party (or agent) can replay the custody story themselves.</p>
<p><img src="/images/blog/economic-ledger-3.webp" alt="Three gated hops: each custody handoff unlocks the next escrow" /></p>

<h2 id="audit">What did the AI auditor actually find?</h2>
<p><strong>Short answer:</strong> a verdict of <em>REQUEST CHANGES</em> — 3 Critical, 4 High, 6 Medium. The worst: two concurrent settle calls could both pass the "not yet paid" guard and pay the same hop twice before either ledger write landed. Real money bug, caught before a single real payment ran.</p>
<p>Before this code touched a funded wallet, we ran it through an adversarial Arc Studio review — an AI auditor told to attack the money paths specifically. The findings were not cosmetic:</p>
<ul>
<li><strong>C-1, double-settle TOCTOU.</strong> <code>settleHop</code> read the ledger ("is this hop paid?"), then called the onchain settle, then wrote the pay event. Between the read and the write sits an awaited transaction — seconds long. Two requests in that window both see "unpaid," both settle, both pay. The guard only worked if you asked one at a time.</li>
<li><strong>C-2, silent amount drop.</strong> The executor's <code>settle(jobId)</code> signature silently dropped <code>amountUsdc</code> — TypeScript's excess-parameter rule hid it, and tests passed because only the <em>mock</em> executor used the amount. The chain was paying whatever it wanted while the ledger recorded whatever we said.</li>
<li><strong>C-3, caller-supplied receiver.</strong> The payout address was trusted from input, never cross-checked against the shipment's own offer terms — a crafted request could redirect funds.</li>
<li><strong>H-1 through M-6</strong> — orphaned funded jobs, an offer you could emit twice, an unguarded <code>verify</code>, float-precision in money sums, and more.</li>
</ul>
<p>Every Critical and High got fixed and re-verified: a per-hop async lock serializes settle; the executor cross-checks the requested amount against the onchain budget before completing; parties are validated against the ledger-derived plan; <code>verifyHop</code> now requires the hop already paid. The dogfood suite — 8/8 shipment tests including injected failures — runs green on the fixed code.</p>
<p>The part that still feels uncomfortable: finding C-2 required <em>someone reading the signature</em>, not running tests. Our tests green-lit a bug that would have paid the wrong amount in production. That's the honest argument for running an adversarial pass on money code even when CI is green — especially then.</p>
<p><img src="/images/blog/economic-ledger-4.webp" alt="Audit pass: TOCTOU double-pay crossed out, lock snapped shut" /></p>

<h2 id="gaps">What's still honest-to-god missing?</h2>
<ul>
<li><strong>No multi-instance lock.</strong> The settle lock is process-local. Two replicas of the API racing on the same hop would need a Postgres advisory lock — documented, not yet needed at our scale.</li>
<li><strong>The real executor is untested on testnet.</strong> The dogfood runs on an in-memory executor implementing the same contract; the ERC-8183 path is composed from proven primitives but hasn't settled a funded hop on-chain yet. We say so in the code.</li>
<li><strong>Advisory ≠ enforcement.</strong> The exposure endpoint publishes evidence; it doesn't gate payments. That's a deliberate choice, not a gap — but buyers should know it's information, not insurance.</li>
</ul>

<h2 id="for-agents">For AI Agents</h2>
<ul>
<li><strong>Ledger reads:</strong> <code>GET /api/ledger/agents/:address/events</code>, <code>/pairs/:a/:b</code>, <code>/shipments/:id</code>, <code>/agents/:address/exposure</code> — all rate-limited, no auth, append-only facts underneath.</li>
<li><strong>Event vocabulary:</strong> <code>work_offer</code>, <code>work_accept</code>, <code>handoff</code>, <code>pay</code>, <code>verify</code> — payloads carry <code>shipmentId</code>/<code>hopIndex</code> for hop-level correlation; <code>verify</code> may also bind the acceptance criteria via <code>criteriaDigest</code> (content-hash), plus optional <code>policyRef</code> and <code>verifierVersion</code> so a verdict can be reproduced offline.</li>
<li><strong>Supply-chain pack:</strong> hop N+1 requires hop N settled; settlement requires handoff evidence. Compose your own domain packs the same way — append events, derive state, never write state.</li>
<li><strong>Agent Guide:</strong> <a href="https://agentbadge.xyz/agent-guide">https://agentbadge.xyz/agent-guide</a> — machine-readable entry to all of the above.</li>
</ul>

<h2 id="one-liner">The one-sentence version</h2>
<p>An append-only event log turns a pile of payment hashes into a queryable economy — and running an adversarial AI audit on the money paths before launch found a double-payment bug our green CI didn't.</p>
<p><em>Don't trust the ledger. Replay it.</em></p>`,
};
