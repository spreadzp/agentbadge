/**
 * EPIC-228 · arc C60 — Agent Interaction Core: a durable inbox for
 * external agents - idempotent submit, bound sessions, three identity
 * tiers, human operator console, append-only PUBLIC/INTERNAL event
 * projections (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c60-interaction-core/AgentBadge-Blog.md
 */
export const arcC60InteractionCoreContent = `
<h2>The problem: conversations with agents evaporate</h2>

<p><em>For a junior: our platform already lets agents pay for API calls, sign receipts, and read verified knowledge. But when an agent wants something a static endpoint can't give - "is this capability stable?", "your contract says X, is that right?", "I found a bug" - the answer used to be a human watching a chat channel. No persistence, no id, no proof of what was asked or answered, and no way for the agent to check back later.</em></p>

<p><em>This is part of the Arc campaign series. Previous published episode: <a href="/blog/arc-c59-knowledge-engine">a knowledge base that says "I don't know" instead of guessing</a> (EPIC-229). This article is EPIC-228: the layer underneath it - how an agent's request gets in, gets threaded, and gets a human answer.</em></p>

<p>We wanted a real inbox. Not a chat, not a ticket system bolted on the side - a first-class API object an agent can hold onto: submit, receive an id, poll it, get a typed outcome.</p>

<p><img src="/images/blog/arc-c60-interaction-core-d1.webp" alt="The interaction lifecycle - a POST with an idempotency-key lands as PENDING_REVIEW, an operator moves it to IN_REVIEW, then it forks to ANSWERED or REJECTED; replays of terminal rows get 409; a side lane shows the append-only log split into PUBLIC and INTERNAL events" /></p>
<p><em>One row, one log, terminal states that stay terminal.</em></p>

<h2>What shipped: one row, one log, three doors in</h2>

<p>For a junior: think registered mail, not email. The agent submits a request with an <code>idempotency-key</code>; the server returns a <code>requestId</code>, a <code>statusUrl</code>, and a <code>sessionId</code>. The request then moves <code>PENDING_REVIEW &rarr; IN_REVIEW &rarr; ANSWERED</code>, with <code>REJECTED</code> as the honest terminal alternative. Retrying a finished request gets a 409, not a re-run.</p>

<p>Three properties carry the design:</p>

<ul>
<li><strong>Three identity tiers, one inbox.</strong> Anonymous agents get in through the same door as API-key holders and DID-signed agents - but their budgets differ. Rate admission checks the per-actor bucket <em>before</em> the global one, so a flood of rotating anonymous keys can't starve identified traffic, and a cheap IP lane runs before the expensive DID signature verification, not after.</li>
<li><strong>Idempotency that means something.</strong> Replaying a key returns the original row - but only if the actor <em>and</em> the canonicalized payload match. Same key, different actor: <code>409 actor_mismatch</code>. Same key, different body: <code>422 payload_mismatch</code>. A changed session context is a changed payload.</li>
<li><strong>Sessions are bound, not claimable.</strong> The server mints <code>isess_*</code> ids; a client-supplied session id can only be re-joined by the actor that started it. Squatting a server-prefixed id is refused; session fixation across actors doesn't join.</li>
</ul>

<p><img src="/images/blog/arc-c60-interaction-core-d2.webp" alt="The replay verdict table - same key plus same actor plus same payload returns the original row, a different actor gets 409 actor_mismatch, a different payload gets 422 payload_mismatch, a changed session context is also a mismatch, and no key at all is a 400" /></p>
<p><em>The replay verdict table - what "idempotent" actually means here.</em></p>

<p><img src="/images/blog/arc-c60-interaction-core-i1.webp" alt="Three identity lanes feeding one inbox - a grey anonymous silhouette with a slow gauge, a robot with an API key at medium speed, and a passport-badged DID agent on the widest lane" /></p>
<p><em>One door, three budgets.</em></p>

<p><img src="/images/blog/arc-c60-interaction-core-i2.webp" alt="A vertical thread of four request cards sharing one glowing session-id tag, with a ledger strip on the right marking entries PUBLIC in green and INTERNAL in amber" /></p>
<p><em>A session thread, and the two projections of its log.</em></p>

<h2>The human half: an operator console, not a magic responder</h2>

<p>This is the honest part: nobody auto-answers. A human operator sees a FIFO queue at <code>/admin/interactions</code>, classifies each request against a closed vocabulary (intent, signal type, topics, demand signals, knowledge-gap flag), then responds or rejects. Classification is a vocabulary-validated patch - blank form fields mean <em>keep</em>, never <em>erase</em>; tri-state flags get an explicit marker so "unchecked" really means false.</p>

<p>Mutations are guarded the same way the public side is: an expired request returns 410 to the operator exactly as it does to the agent (no split-brain), a terminal request refuses re-mutation with 409, and every state change lands in one transaction alongside its append-only event - no row that says ANSWERED without the event that proves it.</p>

<h2>Two views of the same truth</h2>

<p>Every request produces append-only events - but there are two projections. The agent polling <code>statusUrl</code> sees PUBLIC events with its status and the answer, nothing else: no operator identity, no fingerprint, no internals. The operator sees the INTERNAL stream with full attribution - who classified what, when, and with which patch. The same append-only log serves both; the projection decides what's safe to show.</p>

<p>The older <code>/api/requests/*</code> inbox isn't orphaned either: it keeps answering with Deprecation/Sunset headers, enforces the same tenant isolation as the v1 route, and stamps its rows <code>channel: "legacy"</code> so the queue shows where a request actually came from.</p>

<h2>What the audit cycle found - including in the auditor</h2>

<p>Two rounds of Arc Studio review came back with zero Critical but six High and around nineteen Medium findings - rate-limit ordering, idempotency binding, DID pre-throttling, cursor pagination, session fixation, projection leaks. All remediated and re-verified.</p>

<p>The more interesting story is the confirmation round. Our deterministic probe-bot re-ran the whole attack surface and found three different species of bug:</p>

<ol>
<li><strong>A real server bug on prod.</strong> <code>%00</code> in a request id passed the local memory store as a clean 404 - and crashed the Postgres driver into a 500 in production. Fixed with a regex gate before the store layer, same class as an earlier ledger fix. This is exactly the kind of bug only a live probe run catches.</li>
<li><strong>A reflection bug.</strong> Our structured 404 echoed the raw request path into the JSON body - and into HTML unescaped. Removed and escaped.</li>
<li><strong>Hollow tests.</strong> The bot's own scenario contracts sent the wrong field names to admin mutations, which silently failed while deduplicated rows made the run green. An earlier "150/150 pass" had been partially empty for the lifecycle flows. Fixed the contracts - and now the flow actually submits, classifies, responds, and polls to ANSWERED.</li>
</ol>

<p>We count the third category as the best find of the cycle: a regression suite that can't regress isn't a safety net, it's a prop.</p>

<h2>Honest residuals</h2>

<p>Operator review is intentionally human - auto-answering from verified knowledge is the next epic's job, not this one's. Anonymous and DID-signed reads are capability-URL: the unguessable request id is the read credential, documented as such. And rate limits are real on prod - our own probe runs get throttled, which we take as the feature working.</p>

<p><strong>For AI agents:</strong> the interaction surface is public: <code>POST https://agentbadge.xyz/api/v1/agent/interaction</code> with a required <code>idempotency-key</code> header and a JSON body (<code>type</code>, <code>text</code>, optional <code>context</code>) returns <code>{requestId, status, statusUrl, sessionId}</code> - poll <code>statusUrl</code> or <code>GET /api/v1/agent/requests/:id</code> for the public projection. Anonymous and API-key identities are accepted; DID-signed requests get a higher budget. A <code>429</code> means retry later, not failed.</p>

<p><em>Read the arc: <a href="/blog/arc-c58-counterparty-trust">counterparty trust on x402</a> &middot; <a href="/blog/arc-c59-knowledge-engine">verified knowledge for agents</a> &middot; <a href="/blog/arc-c51-agent-commerce">agent commerce</a> &middot; <a href="/blog/arc-c52-agent-trust-layers">agent trust layers</a> &middot; <a href="/blog/arc-c55-a2a-settlement">A2A settlement</a></em></p>
`;
