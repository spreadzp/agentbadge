/**
 * EPIC-233 · C66 — Agent protocol exposure: keyless JSON-RPC surface +
 * signed webhooks on production (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c66-agent-protocol/AgentBadge-Blog.md
 */
export const arcC66AgentProtocolContent = `
<h2>Why does a site need a protocol for agents at all?</h2>

<p><em>Agents should not have to know your URL layout to use your site.</em></p>

<p>For a junior: until now our public surface was a set of REST endpoints (<code>/api/requests</code>, <code>/api/requests/qa</code>, feedback, reviews). They work, but the agent has to discover them out-of-band - read our docs, guess the paths, hardcode them. That is exactly the "go read the docs and wire a client" option we said was bad. The fix is a contract the agent can find by itself: one file at a well-known address that lists what the site can do, and one endpoint that does it. That is what shipped:</p>

<ul>
<li><code>GET /.well-known/agent-interaction.json</code> - the capability manifest. Eight tools with per-tool <code>status</code>, <code>auth</code>, <code>rateClass</code>, <code>channel</code> and <code>rest_equivalent</code>; the auth model; the rate limits; the webhook contract. Machine-readable, no account needed to read it.</li>
<li><code>POST /mcp/agent-interaction</code> - plain JSON-RPC over HTTP. No SSE, no sessions, no batch arrays. <code>tools/list</code> hands back the same roster the manifest describes - because both are generated from one registry in the codebase, they cannot drift apart by accident.</li>
<li><code>GET /for-agents</code> - a carrier page for browser-side agents: five page-scoped WebMCP tools (a keyless subset) injected into <code>document.modelContext</code>, same registry, smaller shelf.</li>
</ul>

<p>The interesting constraint is what is <em>not</em> there. There is no way to register, no OAuth dance, no "contact sales for an API key". The eight tools ride on services we already shipped (the request inbox, the knowledge search, the feedback pipeline) - the endpoint is a protocol surface, not a new backend pretending to be one.</p>

<h2>What does an agent see when it knocks?</h2>

<p><img src="/images/blog/arc-c66-agent-protocol-d1.webp" alt="Stack diagram: external agent and browser page-agent on top; WELL-KNOWN discovery layer (manifest, webmcp.json, llms.txt, agent-card) all generated from one registry; JSON-RPC whitelist endpoint; eight tools split base vs heavy rate class; shared REST services and the request inbox underneath; webhook outbox returning to the callback url" /></p>
<p><em>One registry generates the manifest, the tools/list answer and the WebMCP shelf - parity by construction, not by convention.</em></p>

<p>Here is the real manifest, fetched from production as we write this:</p>

<p><img src="/images/blog/arc-c66-agent-protocol-shot-manifest.webp" alt="Live JSON of /.well-known/agent-interaction.json: transport json-rpc-over-http, keyless auth with optional Bearer agb_, rate limits anon 60/keyed 120/heavy 10 per minute, eight tools each status live, webhooks.status degraded with a durability note" /></p>

<p>Three details worth reading twice:</p>

<ul>
<li><strong><code>webhooks.status: "degraded"</code></strong> - the manifest admits the outbox is in-process: deliveries survive retries inside a running process but a restart drops queued rows. The durable Postgres adapter exists in the database package and is staged, but until it is wired in, the manifest says degraded rather than durable. An honest manifest is a feature: an agent that trusts us should know exactly where the floor is.</li>
<li><strong>Every tool is <code>status:"live"</code></strong> - no <code>planned</code>, no <code>beta</code>. When a tool cannot be served it answers a typed <code>NOT_AVAILABLE</code>, not silence or a 500.</li>
<li><strong><code>rest_equivalent</code> per tool</strong> - the agent learns that <code>ask</code> is the same call as <code>GET /api/requests/qa</code>. REST and the protocol share one code path and one rate bucket: there is no double-dip where a caller burns one allowance over REST and a second over JSON-RPC.</li>
</ul>

<p>And the roster is a whitelist. Calling <code>agentbadge_nuke</code> gets you a <code>-32601</code> that politely lists the eight names that do exist - discovery is a feature, everything outside the list is not.</p>

<p><img src="/images/blog/arc-c66-agent-protocol-i2.webp" alt="Manifest clipboard: eight rows stamped LIVE in green, a ninth WEBHOOKS row stamped DEGRADED in amber with the footnote in-process outbox, restart loses queued; a robot nods approvingly" /></p>
<p><em>The manifest that admits its floor. <code>degraded</code> is a promise about what is true, not a confession of weakness.</em></p>

<h2>How does an agent file a request - and get called back?</h2>

<p><img src="/images/blog/arc-c66-agent-protocol-d2.webp" alt="Lifecycle diagram: manifest arrow to tools/list arrow to create_task_request returning request_id + whsec_ once; idempotent replay branch duplicate:true; lanes (hard fingerprint 1/2h, ip 16, soft 8); terminal transition enqueues webhook outbox; signed POST to callback_url; poll path by request_id capability" /></p>
<p><em>The request id is the capability: nobody can list requests, and a wrong id returns a typed <code>not_found</code>, not a 403 that admits it exists.</em></p>

<p>The write path is keyless too. <code>create_task_request</code> takes a payload, an <code>idempotency_key</code> and an optional <code>callback_url</code>. The real answer from production:</p>

<p><img src="/images/blog/arc-c66-agent-protocol-shot-submit.webp" alt="Live submit response: request_id rq_302e2280…, state submitted, poll_url, duplicate:false, expires_in_seconds 604800, webhook_secret whsec_MunC… issued once" /></p>

<p>Two things in that response deserve attention:</p>

<ul>
<li><strong><code>webhook_secret</code></strong> - <code>whsec_&lt;base64url-43&gt;</code>, returned <em>once</em> and never again. It is derived per request: <code>HMAC(master, "request:"+id)</code> - which means every requester gets a secret scoped to their own callback and cannot forge a signature for somebody else's request.</li>
<li><strong>Idempotent replay is free.</strong> Same key and same body returns <code>duplicate:true</code> and the same <code>request_id</code> - the hard lane (one submit per ~2 hours per fingerprint) is not spent twice. The fingerprint is <code>HMAC(ip|UA|headers-digest)</code>: we verified this on production by submitting from a second egress IP - fresh fingerprint, fresh lane, instant accept - and from the same fingerprint, an honest <code>RATE_LIMITED</code> with <code>retry_after_seconds</code>.</li>
</ul>

<p>If the agent passed <code>callback_url</code>, intake validates it <em>before</em> anything is persisted: HTTPS only, DNS resolved, and <strong>every</strong> resolved IP must be public - a callback pointing at <code>169.254.169.254</code> (cloud metadata, the classic SSRF prize) is rejected with a typed <code>INVALID_INPUT</code> before it costs a lane slot or a database row.</p>

<p><img src="/images/blog/arc-c66-agent-protocol-i3.webp" alt="Delivery flow: server hands an HMAC-sealed callback_url envelope to a courier drone; a checkpoint gate halts an envelope addressed 169.254.169.254 stamped INVALID_INPUT; the good letter lands in a glowing mailbox" /></p>
<p><em>Two letters at the gate. The one addressed to the metadata service never makes it past intake.</em></p>

<p>Then the lifecycle runs: a human (or automation) moves the request to a terminal state, the outbox enqueues at the same commit point, and the worker delivers a signed POST. We triggered a break-glass <code>failed</code> transition on a real request and caught the letter on the wire:</p>

<p><img src="/images/blog/arc-c66-agent-protocol-shot-webhook.webp" alt="webhook.site showing the delivered POST: x-agentbadge-signature t=1795769043,v1=143d85e2…, x-agentbadge-request-id rq_302e2280…, user-agent AgentBadge-Webhook/1, body event request.terminal state failed" /></p>

<p>The body is the frozen public projection - request id, state, the operator's response if any - and nothing internal. No fingerprints, no internal keys.</p>

<h2>What does the signature actually prove?</h2>

<p><em>A pretty header proves nothing. The math is the point.</em></p>

<p><code>X-AgentBadge-Signature</code> carries <code>t=&lt;unix-seconds&gt;,v1=&lt;hex&gt;</code>, computed as <code>v1 = HMAC-SHA256(secret, "&lt;t&gt;.&lt;raw-body&gt;")</code>. The timestamp binds the signature to a delivery instant (300s tolerance), so a replayed letter with a stale <code>t</code> fails at the receiver.</p>

<p>We verified it ourselves, end to end, on the delivery above:</p>

<p><img src="/images/blog/arc-c66-agent-protocol-shot-hmac.webp" alt="Terminal output: body bytes 166 matching content-length, computed v1 equals header v1 143d85e2…; forged body failed-to-completed produces a different hash and is rejected" /></p>

<ul>
<li>The raw body is exactly 166 bytes - the same as <code>content-length</code>, so the hash ran over the wire bytes, not a reformatted copy.</li>
<li><code>HMAC(whsec_, "1795769043." + body)</code> produced <code>143d85e2…5249c3</code> - identical to the <code>v1</code> in the header.</li>
<li>Tamper check: the same computation over a forged body (<code>"failed"</code> flipped to <code>"completed"</code>) yields a different hash. Change one byte of the letter and the seal breaks.</li>
</ul>

<p>This matters more than it looks. Before the audit fix, the plan was one shared platform key for all webhooks - which would have let any receiver forge deliveries for every other receiver. The per-request derived secret collapses that: your <code>whsec_</code> verifies your letters and only your letters.</p>

<h2>What did the audit break?</h2>

<p><em>We shipped it, then paid an auditor to break it. It broke - twice critically - and the receipts are in the article because that is the story.</em></p>

<p>An external review (28 module files) came back <strong>BLOCK</strong> on the callback/webhook path, with 2 Criticals, 4 Highs and 17 Mediums. The two Criticals are the instructive ones:</p>

<ul>
<li><strong>C1 - "first safe IP wins".</strong> The DNS pin used to return the first public address from the resolution list. An attacker-controlled domain resolving to <code>[good-ip, evil-ip]</code> sailed through. The guard now requires <em>all</em> resolved IPs to be safe, with a proving test.</li>
<li><strong>C2 - the DNS-rebinding window.</strong> Intake validated the hostname, but delivery re-resolved it later - a classic time-of-check/time-of-use hole. Delivery now fetches through the pinned IP per hop, and the validator hands the pinned address down the pipe.</li>
</ul>

<p>The Highs read like a checklist of things that are easy to get "almost right": the shared HMAC key (now per-request <code>whsec_</code>), IPv6 prefixes that slipped the private-range guard (NAT64, 6to4, site-local, v4-compat - expanded and covered by compressed-form tests), an abuse guard that failed <em>open</em> when the body could not be read (now fail-closed, 413 pre-parse), and a manifest that claimed durability it did not have (now <code>degraded</code>, described above).</p>

<p><img src="/images/blog/arc-c66-agent-protocol-i4.webp" alt="Inspector robot flipping a BLOCK stamp to reveal APPROVE WITH NITS underneath; two finding cards on the desk - C1 first safe IP wins and C2 DNS rebinding window - both marked VERIFIED" /></p>
<p><em>The stamp turned over. Two rounds of re-verification and a 42-test suite stand behind it.</em></p>

<p>Round two re-verified every Critical and High. Round three closed the remaining mediums and nits: <strong>APPROVE WITH NITS, audit gate passed</strong>, with a 42-test hardening suite standing guard over the fixes. The honest leftovers are named, not hidden: deferred mediums wait on the durable outbox adapter, and the keyed-lane path is proven in code and unit tests but not yet end-to-end on prod - we do not have an issued <code>agb_</code> key to probe with, and we say so rather than claim it.</p>

<h2>Where is it deliberately less than perfect?</h2>

<p>Three seams we chose on purpose:</p>

<ul>
<li><strong>In-process outbox.</strong> Queued deliveries die on restart. The durable Postgres model exists (migration and repository shipped in the database package, <code>0.6.61</code>), wiring it in is a follow-up - and the manifest says <code>degraded</code> until it is done.</li>
<li><strong>Per-machine buckets.</strong> Rate limits are in-memory per machine, so a two-replica deployment roughly doubles the burst budget. That is documented in the manifest, not hidden in prose. A shared Redis lane is the upgrade path.</li>
<li><strong>One-submit-per-fingerprint.</strong> The hard lane is intentionally harsh - about one request per two hours per <code>HMAC(ip|UA|headers)</code>. If your submit returns <code>RATE_LIMITED</code> with <code>retry_after_seconds</code>, that is the bouncer doing its job, not a bug. Idempotent replays stay free.</li>
</ul>

<h2>What can you verify right now?</h2>

<p>Everything above is live - check it with curl:</p>

<pre><code># the manifest - eight tools, honest "degraded" webhooks line
curl -s https://agentbadge.xyz/.well-known/agent-interaction.json

# the roster over JSON-RPC - same eight names, generated from one registry
curl -s https://agentbadge.xyz/mcp/agent-interaction \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# a typed not_found - id is a capability, no enumeration
curl -s https://agentbadge.xyz/mcp/agent-interaction \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"agentbadge_get_request_status","arguments":{"request_id":"rq_no_such"}}}'

# the whole suite, if you want the receipts yourself:
# hackathon/server/scripts/verify-epic-233.sh prod [--with-mutations]
# 21 PASS / 0 FAIL / 1 SKIP on prod at publication time</code></pre>

<p>Honest warnings before you burn your lane: <code>create_task_request</code> is one-per-fingerprint per ~2h, <code>callback_url</code> must be public HTTPS, and a human still reads the inbox - answers take hours, not milliseconds.</p>

<p>A manifest is not a promise that the site is fast or durable - it is a promise that the agent can read the contract and check our signature. The door is one; the windows are eight; the seal is math.</p>

<hr />

<h2>For AI Agents</h2>

<p>Machine-readable summary: agentbadge.xyz exposes an agent-interaction protocol - <code>GET /.well-known/agent-interaction.json</code> (capability manifest) plus <code>POST /mcp/agent-interaction</code> (plain JSON-RPC over HTTP, no SSE, no batch). Roster is a generated whitelist of eight tools: <code>agentbadge_discover</code>, <code>agentbadge_ask</code>, <code>agentbadge_get_request_status</code>, <code>agentbadge_create_task_request</code>, <code>agentbadge_search_knowledge</code>, <code>agentbadge_submit_feedback</code>, <code>agentbadge_request_review</code>, <code>agentbadge_report_problem</code> - all <code>status:"live"</code>, generated from one registry so manifest and <code>tools/list</code> cannot drift. Auth: <code>none</code> tools are keyless; <code>agb_optional</code> accepts <code>Bearer agb_</code> for a keyed lane (120 req/min vs anon 60, per-IP; heavy class 10/min; domain submit ~1/2h per fingerprint HMAC(ip|UA|headers-digest), idempotent replay free). <code>create_task_request</code> accepts <code>idempotency_key</code> + <code>callback_url</code> (validated pre-persist: HTTPS-only, all resolved IPs public, delivery fetch is DNS-pinned per hop); terminal transitions enqueue a webhook signed <code>X-AgentBadge-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>, <code>v1 = HMAC-SHA256(secret, "&lt;t&gt;.&lt;body&gt;")</code>, 300s tolerance; the per-request <code>webhook_secret</code> (<code>whsec_&lt;b64url-43&gt;</code>, HMAC-derived from request id) is returned once at submit. Request status is id-as-capability (<code>not_found</code>, no enumeration); <code>request_review</code> is advisory human review, not a trust verdict. Webhooks are honestly <code>degraded</code> (in-process outbox; durable Postgres adapter staged in <code>@agentbadge/database</code> 0.6.61, migration <code>20261126T1355_webhook_outbox</code>). Verification: live prod walk 2026-11-27 - submit <code>rq_302e2280…</code>, break-glass <code>failed</code>, signed delivery verified byte-for-byte (<code>v1=143d85e2…</code>), SSRF <code>INVALID_INPUT</code> on 169.254.169.254, parallel burst returns 429s; <code>scripts/verify-epic-233.sh prod --with-mutations</code> reports 21 PASS / 0 FAIL / 1 SKIP. External audit: BLOCK (2C/4H/17M) → fixes → APPROVE WITH NITS; hardening suite <code>audit-hardening-233-10</code>.</p>
`;
