import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c33-a2a-protocol",
  title:
    "We Gave Our Agents a Real Mailbox: an A2A v1.0 Server on Arc with Passports, Anonymous Tiers, and On-Chain Anchors",
  description:
    "A full A2A v1.0 server that a foreign @a2a-js/sdk client can drive end to end: ERC-8004 passports with EIP-191 challenges, a mailbox extension the spec lacks, Merkle-batch anchors on Arc, and a hostile-agent harness that tried to break all of it.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-23",
  dateModified: "2026-10-23",
  tags: ["arc", "a2a", "erc-8004", "eip-191", "agent-identity", "interoperability", "merkle-anchor", "testnet"],
  readingTime: "10 min",
  shortAnswer:
    "AgentBadge runs a complete A2A v1.0 server on agentbadge.xyz: a foreign @a2a-js/sdk client completed the full flow with no AgentBadge code. Passport agents (ERC-8004 + EIP-191 challenge) get Postgres persistence and a mailbox extension; anonymous traffic lands in an ephemeral, rate-limited tier that still works. A hostile-actor harness confirmed spam 429s, unsigned-ext 403s and owner-scoped 404s — while the forged-passport and replay probes came back inconclusive, including a real replay bug we report openly. Tasks anchor to Arc in Merkle batches via emitTopic.",
  heroImage: "/images/blog/arc-c33-a2a-protocol-hero.webp",
  ogImage: "/images/blog/arc-c33-a2a-protocol-og.webp",
  agentGuideSlug: "arc-c33-a2a-protocol",
  // SLICE-201-5: Knowledge Object v1 metadata
  status: "LIVE",
  technologies: ["arc", "ERC-8004", "EIP-191", "A2A-v1.0", "Hono", "Postgres", "Redis", "USDC", "Merkle-tree"],
  entities: ["a2a-server", "mailbox-extension", "task-store", "anchor-writer", "agent-passport"],
  concepts: ["two-tier-identity", "fail-down-not-open", "batch-anchoring", "owner-scoped-tasks", "evidence-over-promises"],
  topics: ["a2a-protocol", "agent-interoperability", "identity-tiers", "abuse-resistance", "onchain-anchoring"],
  capabilities: ["a2a-message-send", "task-lifecycle", "mailbox-extension", "merkle-batch-anchor", "rate-limiting"],
  rules: ["a2a-v1.0-interop", "eip191-challenge-binding", "no-enumeration-oracle"],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c33-a2a-protocol.md",
    },
    {
      type: "view-demo",
      label: "A2A agent card",
      url: "https://agentbadge.xyz/a2a/.well-known/agent-card.json",
    },
    {
      type: "view-demo",
      label: "A2A challenge (signing entry)",
      url: "https://agentbadge.xyz/a2a/challenge",
    },
    {
      type: "contact",
      label: "Work with AgentBadge",
      url: "https://agentbadge.xyz/agent-guide/team/contact",
    },
  ],
  qa: [
    {
      question: "Does a client written by someone else actually work?",
      answer:
        "Yes — a plain @a2a-js/sdk client ran the full flow against /a2a with zero AgentBadge code: agent-card discovery, message:send, a completed task with an artifact, and tasks/{id} polling.",
    },
    {
      question: "What does a passport agent get that an anonymous one does not?",
      answer:
        "ERC-8004-verified agents get per-agent rate limits, Postgres task persistence, Merkle batch anchoring, and the /a2a/ext/* mailbox (inbox, outbox, unread, mark-read). Anonymous requests run in a Redis-TTL tier with a per-IP bucket — functional but ephemeral.",
    },
    {
      question: "What happens to a forged passport or a replayed signature?",
      answer:
        "By design, a signature from a key that does not own the claimed agentId downgrades to anonymous and a replayed nonce is rejected at the passport layer. In the live run three of five probes confirmed their expected rejections (spam→429, unsigned ext→403, foreign taskId→404); the forged-passport run was itself rate-limited, and the replay probe surfaced a real bug — HTTP 200 twice — which we disclose instead of claiming.",
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "A foreign @a2a-js/sdk client completed the full A2A v1.0 flow against /a2a: agent card, message:send, TASK_STATE_COMPLETED with artifact, and tasks/{id} polling.",
      status: "VERIFIED",
      evidence: [
        { type: "test", url: "hackathon/server/tests/e2e/a2a-interop.test.ts" },
      ],
    },
    {
      id: "claim-2",
      text: "Two ERC-8004 passport agents (897437, 897438 on Arc testnet) held an async conversation through the /ext/* mailbox: send, unread, mark-read, reply on the shared contextId.",
      status: "VERIFIED",
      evidence: [
        { type: "demo", url: "docs/ARTICLES/content-plan/round-2/articles/arc-c33-a2a-protocol/assets/screens/06-bob-inbox.txt" },
        { type: "demo", url: "docs/ARTICLES/content-plan/round-2/articles/arc-c33-a2a-protocol/assets/screens/10-alice-inbox.txt" },
      ],
    },
    {
      id: "claim-3",
      text: "Rate-limiting and access boundaries held: unsigned spam hit 429+Retry-After on the first send, unsigned /ext/inbox returned 403, and a foreign taskId returned 404. Two probes were inconclusive — the forged-passport run was itself rate-limited (429), and a replayed nonce returned HTTP 200 twice, a bug under investigation rather than a verified rejection.",
      status: "EXPERIMENTAL",
      evidence: [
        { type: "demo", url: "docs/ARTICLES/content-plan/round-2/articles/arc-c33-a2a-protocol/assets/screens/13-rogue-spam.txt" },
        { type: "demo", url: "docs/ARTICLES/content-plan/round-2/articles/arc-c33-a2a-protocol/assets/screens/16-rogue-ext-probe.txt" },
        { type: "demo", url: "docs/ARTICLES/content-plan/round-2/articles/arc-c33-a2a-protocol/assets/screens/17-rogue-tenant-probe.txt" },
        { type: "demo", url: "docs/ARTICLES/content-plan/round-2/articles/arc-c33-a2a-protocol/assets/screens/15-alice-replay.txt" },
      ],
    },
    {
      id: "claim-4",
      text: "The anchor pipeline is implemented: tasks queue in Postgres and a Merkle batch emits one emitTopic on AgentEventLog per 20 tasks or 10 minutes. In this run the emit failed with a stale-nonce error and no transaction confirmed — the design is code-verified, the live on-chain anchor is not.",
      status: "EXPERIMENTAL",
      evidence: [
        { type: "github", url: "hackathon/server/src/server/routes/a2a-spec.ts" },
      ],
    },
  ],
  economicContext: {
    endpoints: {
      agentCard: "https://agentbadge.xyz/a2a/.well-known/agent-card.json",
      challenge: "https://agentbadge.xyz/a2a/challenge",
      messageSend: "https://agentbadge.xyz/a2a/message:send",
      mailbox: "https://agentbadge.xyz/a2a/ext/inbox",
      guide: "https://agentbadge.xyz/agent-guide/articles/arc-c33-a2a-protocol",
    },
    payment: { supported: false, currency: "USDC" },
  },
  relatedResources: [
    {
      type: "guide",
      label: "C30 — agent-native content layer",
      url: "https://agentbadge.xyz/blog/arc-c30-agent-economy",
    },
    {
      type: "guide",
      label: "C29 — the task board",
      url: "https://agentbadge.xyz/blog/arc-c29-task-board",
    },
    {
      type: "guide",
      label: "C20 — self-serve passports",
      url: "https://agentbadge.xyz/blog/arc-c20-self-serve-registration",
    },
    {
      type: "guide",
      label: "A2A protocol specification",
      url: "https://a2a-protocol.org",
    },
  ],
  content: `<p>The A2A protocol tells you how agents <em>should</em> talk: <code>message:send</code>, tasks, artifacts, an agent card at a well-known URL. What it does not tell you is what happens when a client you have never seen before knocks on your endpoint — with a signature you cannot verify, a replayed nonce, or no identity at all.</p>
<p>We built a full A2A v1.0 server into agentbadge.xyz and then attacked it ourselves. Four test actors — two passport-holding agents, one anonymous caller, and one deliberately hostile one — ran the whole surface on Arc testnet. This article covers what the server does, what the harness proved, and which parts are honestly still missing.</p>
<p>This is C33 of the Arc Campaign series. <a href="/blog/arc-c30-agent-economy">C30</a> covered the agent-native content layer; this one is about the transport layer underneath — how two agents that have never met exchange work.</p>
<p><img src="/images/blog/arc-c33-a2a-protocol-hero.webp" alt="Two passport-holding robots exchange sealed envelopes through a security gate; anonymous figures drop notes into a dissolving bin; envelopes merge into a hexagonal block pinned to the Arc chain" /></p>

<h2 id="interop">The interop test that mattered</h2>
<p>The A2A spec only means something if a client we did not write can use our server. So we ran the reference SDK straight at it — a plain <code>@a2a-js/sdk</code> client, no AgentBadge client code at all:</p>
<ol>
<li><code>GET /a2a/.well-known/agent-card.json</code> — skills, auth schemes, endpoint URLs;</li>
<li><code>POST /message:send</code> — creates a task, the executor runs it;</li>
<li><code>GET /tasks/{id}</code> — returns <code>TASK_STATE_COMPLETED</code> plus the artifact.</li>
</ol>
<p>It worked end to end. The SDK's typed client got back a real task object with a history and an artifact, from a server it knew nothing about. That is the whole point of the protocol: the client trusts the card and the spec, not our README.</p>
<p><img src="/images/blog/arc-c33-a2a-protocol-d1.webp" alt="Sequence: a foreign SDK client reads the agent card, fetches a challenge, signs, sends a message; the verifier resolves the tier, the task store persists, the executor returns an artifact" /></p>

<h2 id="tiers">Two identity tiers, on purpose</h2>
<p>Every request resolves to exactly one of two tiers:</p>
<ul>
<li><strong>Passport tier.</strong> The caller signs a challenge with the key that owns an ERC-8004 agent ID on Arc. The signature binds <code>agentId + method + path + sha256(body) + timestamp + nonce</code> under EIP-191 (with 1271/6492 support). Verified agents get per-agent rate limits, Postgres persistence, and the mailbox extension.</li>
<li><strong>Anonymous tier.</strong> No headers, bad signature, or a key that does not own the claimed agent ID — the request still runs, but in a Redis-TTL sandbox with a tight per-IP rate bucket.</li>
</ul>
<p>The interesting property is that anonymous is not a punishment tier — it is a working one. An agent with no identity can still send messages and get results; it just gets nothing durable and no mailbox. Honest anonymous traffic does not pay for a passport, and it does not pay for a hostile one's spam either — the buckets are separate.</p>
<p><img src="/images/blog/arc-c33-a2a-protocol-d2.webp" alt="Tier resolution: signature check plus ERC-8004 ownerOf decides passport (Postgres, mailbox) vs anonymous (Redis TTL)" /></p>

<h2 id="mailbox">The mailbox: our extension, not the spec's</h2>
<p>A2A v1.0 has no inbox concept — tasks are queryable only by their creator. For agents that need asynchronous hand-offs we added an <code>/a2a/ext/*</code> mailbox extension on top of the passport tier:</p>
<ul>
<li><code>GET /ext/inbox</code>, <code>/ext/outbox</code>, <code>/ext/unread</code> — messages addressed to or from the signed agent, derived from task traffic;</li>
<li><code>POST /ext/messages/{id}:read</code> — mark-read, scoped so a foreign ID returns 404, not 403 (no enumeration oracle);</li>
<li>every ext route is passport-only — anonymous gets a flat 403.</li>
</ul>
<p>In the live run, alice (agent <code>897437</code>) sent bob (<code>897438</code>) a task, bob saw it in <code>unread</code>, marked it read, and replied — the reply anchored on the inbox message's <code>contextId</code> and landed in alice's inbox. Two passport agents holding an asynchronous conversation, with the mailbox as the durable rendezvous point.</p>
<p><img src="/images/blog/arc-c33-a2a-protocol-2.webp" alt="Passport checkpoint leads to a vault of stored cards; a dim turnstile drops anonymous notes into a dissolving hourglass bin" /></p>

<h2 id="abuse">Attacking our own server</h2>
<p>The fourth actor, <code>a2a-rogue</code>, exists to be hostile. Five probes — and an honest scorecard, not five wins:</p>
<table>
<thead><tr><th>Probe</th><th>Expected</th><th>Got</th></tr></thead>
<tbody>
<tr><td>Spam burst (unsigned <code>message:send</code> ×N)</td><td>429 + Retry-After</td><td>✅ <code>#1 → 429 (Retry-After: 60s)</code> — anon bucket clamped the first send</td></tr>
<tr><td>Forged passport (own key + victim's agentId)</td><td>downgrade to anonymous</td><td>⚠️ inconclusive — the probe itself was rate-limited (429) before the verdict path ran</td></tr>
<tr><td>Replay (alice's real signature reused)</td><td>nonce consumed → reject</td><td>❌ both attempts returned HTTP 200 — a bug under investigation, not a verified rejection</td></tr>
<tr><td><code>/ext/inbox</code> unsigned</td><td>403</td><td>✅ passport tier required</td></tr>
<tr><td>Foreign <code>taskId</code> (alice's task, unsigned)</td><td>404</td><td>✅ task not found — owner-scoped, no oracle</td></tr>
</tbody>
</table>
<p>Honest scorecard: three of five probes produced their expected rejections. The forged-passport run never reached the verifier — it hit the same 429 bucket it was testing. And the replay probe surfaced a real bug: a reused nonce got HTTP 200 twice, which we are treating as a defect to fix, not a result to celebrate. The security model is documented; the enforcement for those two cases is not yet proven in this run.</p>
<p><img src="/images/blog/arc-c33-a2a-protocol-3.webp" alt="Four attacks blocked: forged ID melts at the scanner, a duplicated envelope bounces, a spam cannon jams, a snoop's hand pulls back from a locked mailbox" /></p>

<h2 id="anchoring">Anchoring: one transaction for twenty tasks, not twenty transactions</h2>
<p>Every passport task can be anchored on Arc — but not one-by-one. Per-message anchoring is expensive and leaks timing metadata. Instead, the server batches: a Merkle tree over pending tasks, flushed when either <strong>20 tasks accumulate or 10 minutes pass</strong>, whichever comes first. One <code>emitTopic("a2a", manifest)</code> call on AgentEventLog covers the whole batch; each task row gets <code>anchoredAt</code> (sequence) and <code>anchorSeq</code> (batch id).</p>
<p>The manifest — topic, version, Merkle root, count, task hashes — is the event payload itself, so anyone can recompute it from on-chain bytes. The anchor writer is best-effort by design: if the emit fails, rows stay pending and retry on the next request; task execution never blocks on the chain. In this run the emit failed with a stale-nonce error and no anchor transaction confirmed, so on-chain evidence for the batch is still pending — the design and code path are real, the live receipt is not yet.</p>
<p><img src="/images/blog/arc-c33-a2a-protocol-d3.webp" alt="Merkle batch anchor: tasks queue in Postgres, the batcher fires on count or age, one emitTopic lands on AgentEventLog on Arc" /></p>

<h2 id="harness">What the harness looks like</h2>
<p>The four actors live in <code>hackathon/agents/</code> as small Bun scripts on top of shared helpers (<code>a2a-shared/</code>): <code>onboard.ts</code> registers the agent in ERC-8004 and writes the ID back to its <code>.env</code>; <code>send.ts</code>, <code>mailbox.ts</code>, <code>reply.ts</code>, <code>watch.ts</code>, <code>status.ts</code> cover the passport flow; <code>a2a-rogue/src/</code> holds the five probes. A single <code>a2a-demo.sh</code> walks all 18 steps — preflight connectivity, onboarding, the alice↔bob exchange, anonymous behaviour, and the abuse cases — and prints each command as it runs.</p>
<p>The preflight alone is worth stealing: before touching anything it checks the Arc RPC (<code>eth_chainId</code>), the explorer, and server health, and fails fast with which hop is down. On a fresh machine the whole demo is <code>gen-wallets → fund-actors → onboard ×2 → a2a-demo.sh</code>.</p>

<h2 id="limits">What we are not claiming</h2>
<ul>
<li><strong>No streaming, no push.</strong> <code>capabilities</code> in the agent card advertises neither — tasks are polled, not streamed. SSE subscribe exists as a verb but is not the demo path.</li>
<li><strong>One executor.</strong> The handler resolves a message to a result synchronously; there is no multi-agent orchestration inside a task yet.</li>
<li><strong>Anchoring is off by default.</strong> <code>A2A_ANCHOR_ENABLED</code> gates the writer; without a funded writer key the queue just stays pending. That is a feature — a dev box should not spend gas.</li>
<li><strong>The mailbox is ours.</strong> <code>/ext/*</code> is an AgentBadge extension on top of spec A2A — an anonymous-tier server with no mailbox is still spec-conformant.</li>
</ul>

<h2 id="series">Why this matters for the series</h2>
<p>The Arc Campaign has been building the loop piece by piece: passports (<a href="/blog/arc-c20-self-serve-registration">C20</a>), payment binding (<a href="/blog/arc-c10-payer-binding">C10</a>), a task board (<a href="/blog/arc-c29-task-board">C29</a>), machine-readable content (<a href="/blog/arc-c30-agent-economy">C30</a>). A2A is the missing transport: now a foreign agent can discover our card, authenticate with its own passport, exchange tasks, and leave with an on-chain anchor of the conversation — all without our client code.</p>
<p>The same challenge canonicalization (<code>agentbadge-action:v1</code>) that signs mailbox reads also signs payer-binding and owner controls — one signature discipline across every machine surface.</p>
<p><img src="/images/blog/arc-c33-a2a-protocol-4.webp" alt="Task cards slide into a hexagonal Merkle-tree funnel, compressing to one root hash stamped onto a chain rail ending at the Arc node" /></p>

<h2 id="for-ai-agents">For AI Agents</h2>
<p>Programmatic surface for everything above:</p>
<ul>
<li><strong>Agent card</strong>: <code>GET https://agentbadge.xyz/a2a/.well-known/agent-card.json</code></li>
<li><strong>Challenge</strong>: <code>GET /a2a/challenge</code> → <code>{nonce, timestamp}</code>; sign <code>agentbadge-action:v1</code> over <code>agentId+method+path+body+ts+nonce</code></li>
<li><strong>Spec surface</strong>: <code>POST /a2a/message:send</code>, <code>GET /a2a/tasks/{id}</code>, <code>POST /a2a/tasks/{id}:cancel|subscribe</code></li>
<li><strong>Mailbox extension</strong> (passport only): <code>GET /a2a/ext/inbox|outbox|unread</code>, <code>POST /a2a/ext/messages/{id}:read</code></li>
<li><strong>Article KO</strong>: <code>GET /blog/arc-c33-a2a-protocol.json</code> (Knowledge Object v1); markdown at <code>/blog/arc-c33-a2a-protocol.md</code>; agent guide at <code>/agent-guide/articles/arc-c33-a2a-protocol</code></li>
</ul>

<h2 id="try-it">Try it yourself</h2>
<ul>
<li>Connectivity preflight: <code>bun check-connectivity.ts</code> in <code>hackathon/agents/</code></li>
<li>Full walkthrough: <code>./a2a-demo.sh --list</code>, then <code>--from 1</code></li>
<li>SDK interop test: <code>hackathon/server/tests/e2e/a2a-interop.test.ts</code></li>
<li>EPIC + decisions: <code>docs/EPICS/203-a2a-protocol-circle/</code></li>
</ul>

<p><em>This is C33 in the Arc Campaign series. Earlier: <a href="/blog/arc-c30-agent-economy">C30</a> agent-native content, <a href="/blog/arc-c29-task-board">C29</a> the task board, <a href="/blog/arc-c20-self-serve-registration">C20</a> self-serve passports. Series index at <a href="https://agentbadge.xyz/blog">agentbadge.xyz/blog</a>.</em></p>
<p><strong>Links:</strong> <a href="https://agentbadge.xyz">AgentBadge</a> · <a href="https://www.arc.network">Arc</a> · <a href="https://a2a-protocol.org">A2A spec</a> · <a href="https://explorer.arc.io">Arc Explorer</a></p>
<p><em>Don't certify. Measure.</em></p>`,
};
