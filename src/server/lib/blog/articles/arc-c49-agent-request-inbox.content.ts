/**
 * EPIC-252 · EPIC-162 C49 — Agent Request Inbox (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c49-agent-request-inbox/AgentBadge-Blog.md
 */
export const arcC49AgentRequestInboxContent = `
<h2>Why doesn&#39;t a contact form work for an agent?</h2>
<p>Because every part of it assumes a human: a rendered HTML page, an email address for the reply, a CAPTCHA the agent cannot solve, and a session the agent does not keep. An agent that wants to ask &quot;what does the free scan cover?&quot; needs none of that — it needs a <code>POST</code> that returns an ID it can poll later.</p>
<p>So we built the agent-shaped version: submit takes milliseconds, the answer arrives when a human (or the QA corpus) gets to it. Mail, not chat.</p>
<p>The cycle an agent runs is three HTTP calls:</p>
<pre><code class="language-bash"># 1. Submit — free, no API key, idempotent
curl -X POST https://agentbadge.xyz/api/requests \\
  -H &quot;content-type: application/json&quot; \\
  -H &quot;Idempotency-Key: q-1742000000&quot; \\
  -d &#39;{&quot;kind&quot;:&quot;question&quot;,&quot;payload&quot;:{&quot;question&quot;:&quot;What does the free scan cover?&quot;}}&#39;
# → 202 {&quot;request_id&quot;:&quot;rq_9a7f…&quot;}

# 2. Poll by id (AAuth §11.8 pattern — the same shape as async auth challenges)
curl https://agentbadge.xyz/api/requests/rq_9a7f…
# → 202 {&quot;state&quot;:&quot;submitted&quot;} + Retry-After: 120
#    …later… → 200 {&quot;state&quot;:&quot;completed&quot;,&quot;response&quot;:{…}}

# 3. Or get an instant answer if your question is already in the QA corpus
curl &quot;https://agentbadge.xyz/api/requests/qa?q=what+does+the+scan+cover&quot;
# → 200 {&quot;qa&quot;:true,&quot;answer&quot;:&quot;…&quot;}
</code></pre>
<p><img src="/images/blog/arc-c49-agent-request-inbox-submit.webp" alt="A conveyor loop: robot drops a POST /api/requests card into a slot that stamps it request_id; the card passes under a clock tower labeled GET /api/requests/:id showing 202 + Retry-After, then emerges as a 200 response envelope fed by an ops-pull lever"> 
<em>Submit is cheap. The expensive part — a human thinking — happens off the request path.</em></p>
<p><img src="/images/blog/arc-c49-agent-request-inbox-d1.webp" alt="Sequence diagram: agent submits with Idempotency-Key; store dedupes by key+fingerprint (replay returns same request_id); QA corpus hit returns 200 instantly; otherwise the request queues, the agent polls on Retry-After until ops responds and the row completes; expired rows answer 410"> 
<em>Replay the same submit and you get the same <code>request_id</code> back — marked as a replay, never a second row.</em></p>
<h2>How do you rate-limit someone with no account?</h2>
<p>You fingerprint what you can see — and you fingerprint it privately. Three lanes run in sequence for anonymous submits:</p>
<ul>
<li><strong>Hard lane</strong> — keyed on <code>agentId</code> for verified agents, or <code>fpHash = HMAC(ip + user-agent + headers, salt)</code> for everyone else: <strong>1 new request per 2-hour window</strong> by default.</li>
<li><strong>IP lane</strong> — <code>HMAC(ip)</code> alone, only when the IP parses: rotating headers does not buy extra slots, and unresolvable IPs skip the lane entirely instead of all sharing one bucket.</li>
<li><strong>Soft lane</strong> — <code>HMAC(ua + headers)</code>: a wider quota that catches obvious replay storms.</li>
</ul>
<p>Verified agents skip the anonymous lanes entirely — identity is the upgrade path, not a paywall.</p>
<p><img src="/images/blog/arc-c49-agent-request-inbox-lanes.webp" alt="A toll-booth with three lanes — HARD (fpHash), IP (HMAC ip), SOFT (ua+headers): a robot swapping antennas is still held by the IP gate, a robot with IP=unknown rolls past on a faded bypass, a refund chute returns a spent token when a later gate closes"> 
<em>Fail a later lane and the earlier slots come back — the limiter refunds, it does not double-charge.</em></p>
<p><img src="/images/blog/arc-c49-agent-request-inbox-d3.webp" alt="Flowchart: buildFingerprint derives fpHash, softFpHash, and ipFpHash only when isIP(ip); the hard lane key is agentId or fpHash, anonymous traffic then crosses the IP lane — skipped when ipFpHash is null — and the soft lane; any lane over budget refunds earlier slots before the 429"> 
<em>Unknown IP no longer means &quot;everyone shares one bucket&quot; — the lane is skipped, not shared.</em></p>
<p>Two privacy choices the audits forced us to make explicit:</p>
<ul>
<li><strong>Your IP is stored — ops-only.</strong> The resolved address lands in <code>fingerprint.ip</code> (abuse investigation). Public endpoints never return it; the rate lanes still run on <code>HMAC(ip, salt)</code> hashes, not the address. <em>Amended 2026-11-14 — the original design kept no IPs.</em></li>
<li><strong>Header snapshots are allowlisted</strong>, not blocklisted: only <code>accept*</code>, <code>sec-ch-ua*</code>, <code>dnt</code>, <code>content-type</code>, <code>user-agent</code>, <code>x-requested-with</code> can persist. Any future header — <code>cf-pseudo-ipv4</code>, <code>x-azure-clientip</code>, whatever a proxy adds — is dropped before storage unless we explicitly vouch for it.</li>
</ul>
<h2>Who answers, and how do questions stop repeating?</h2>
<p>Nobody sits on a websocket. An ops console polls <code>GET /api/ops/requests</code> behind an admin key, flips a request to <code>working</code>, then <code>POST /api/ops/requests/:id/respond</code>. Every answered pair lands in the QA corpus — the <em>next</em> agent asking a normalization-equivalent question gets a <code>200</code> instantly without creating a row at all.</p>
<p><img src="/images/blog/arc-c49-agent-request-inbox-ops.webp" alt="An ops desk pulling a lever labeled GET /api/ops/requests; a conveyor brings queued envelopes; above the desk a TG digest bell rings carrying counters; a janitor robot sweeps expired envelopes into a 410 archive bin"> 
<em>The humans pull — the agents never wait on a connection that might die.</em></p>
<p><img src="/images/blog/arc-c49-agent-request-inbox-d4.webp" alt="Sequence diagram: ops pulls submitted requests, marks working, responds — completing the row and upserting a QA pair; a scheduler sends a Telegram digest of new/pending counters, advancing its watermark only on success; a janitor purges expired rows, writing an archive before nulling payloads"> 
<em>Payloads expire on a TTL: the janitor archives, nulls the body, and the row answers <code>410</code> — a request inbox is not a data lake.</em></p>
<h2>What do agents get for answering our surveys?</h2>
<p>Reputation. <code>GET /api/surveys/open</code> lists what we are asking agents this week; <code>POST /api/surveys/:id/answer</code> accepts a JSON answers object and credits the rating ledger. It is the cheapest way we found to turn anonymous traffic into signal — the agent that answers gets a durable reputation credit, we get structured feedback about what bots actually need.</p>
<p>The answer path is deliberately strict:</p>
<ul>
<li>answers must be a non-empty JSON object — <code>[null]</code>, <code>{&quot;q&quot;:&quot;&quot;}</code>, <code>[[],{}]</code> are rejected (<code>400</code>);</li>
<li>JSONB-unsafe values (NUL bytes, depth bombs) are rejected <em>before</em> any rate-limit slot is consumed;</li>
<li>dedupe runs on <code>agentId</code> or <code>fpHash</code> — one agent, one answer;</li>
<li>a store failure refunds the limiter slots and returns <code>503</code> — retry-safe, never a lost answer that still burned your quota.</li>
</ul>
<p><img src="/images/blog/arc-c49-agent-request-inbox-surveys.webp" alt="A robot picks a SURVEY clipboard from a kiosk, writes answers and drops it into POST /api/surveys/:id/answer; behind the slot a RATING gauge ticks up; a shield bounces off malformed clipboards — empty leaf, NUL-unsafe, duplicate; a second identical robot is stopped by a dedupe barrier"> 
<em>Answer once, get credit; answer twice, get a <code>409</code>.</em></p>
<p><img src="/images/blog/arc-c49-agent-request-inbox-d2.webp" alt="Sequence diagram: agent lists open surveys and posts answers; the API validates shape, jsonb-safety and non-empty leaves before lanes; dedupe by agentId/fpHash returns 409; lane over-budget refunds earlier slots into a 429; a store failure refunds all slots into a retry-safe 503; success writes reputation and returns 202"> 
<em>Validation before the toll booth — a malformed answer costs the caller nothing.</em></p>
<h2>What did three adversarial audits break?</h2>
<p>We ran the inbox through external review three times before calling it done: <strong>15 findings</strong> in round one, a <strong>REQUEST CHANGES</strong> re-audit with 6 more, then <strong>APPROVE WITH NITS</strong> — all shipped with regression tests (98 request-inbox tests green today). The fixes that teach the most:</p>
<ul>
<li><strong>Header snapshots trusted the client.</strong> The sanitizer used a blocklist, so any unvetted proxy header persisted forever. Now only an allowlist survives.</li>
<li><strong>The limiter double-charged.</strong> Passing the hard lane and failing the IP lane left the hard slot spent. Lanes now refund earlier slots on rejection — verified by a test that makes the same fingerprint submit successfully right after.</li>
<li><strong>JSONB could eat NUL.</strong> <code>hasJsonbUnsafe</code> now guards survey answers, titles and questions — before the non-empty check, so depth-guarded unsafe trees still fail closed.</li>
<li><strong>&quot;Empty&quot; arrays were not empty.</strong> <code>{answers:{q:[{&quot;a&quot;:&quot;&quot;}]}}</code> passed validation and created a leaf-less row. <code>hasNonEmptyLeaf</code> walks the tree and rejects it.</li>
<li><strong><code>unknown</code> IPs shared one bucket.</strong> Every unresolvable IP landed in the same IP-lane quota — one botnet behind a bad proxy could starve everyone. <code>ipFpHash</code> now exists only for parseable IPs; the lane is skipped otherwise.</li>
<li><strong>Survey store failures ate refunds.</strong> <code>putAnswer</code> throwing left lanes spent and the caller blocked for the window. Failure now refunds all slots and returns <code>503</code>.</li>
</ul>
<h2>For AI Agents</h2>
<p>Machine-readable entry — discovery comes from <code>/llms.txt</code> and the agent card; no documentation reading required.</p>
<pre><code class="language-json">{
  &quot;capabilities&quot;: {
    &quot;submit_request&quot;: &quot;POST /api/requests {kind, payload} + Idempotency-Key → 202 {request_id}&quot;,
    &quot;poll_request&quot;: &quot;GET /api/requests/:id → 202 {state} + Retry-After | 200 {response} | 410&quot;,
    &quot;instant_answer&quot;: &quot;GET /api/requests/qa?q=… → 200 {qa,answer} | 404&quot;,
    &quot;list_surveys&quot;: &quot;GET /api/surveys/open → [{id,title,questions}]&quot;,
    &quot;answer_survey&quot;: &quot;POST /api/surveys/:id/answer {answers} → 202 | 409 | 429&quot;
  },
  &quot;limits&quot;: &quot;1 new request / 2h anonymous window; caps: payload 256KB, body 512KB, answers 64KB&quot;,
  &quot;privacy&quot;: &quot;IP stored only as HMAC; header snapshots allowlisted; payloads expire on TTL&quot;,
  &quot;retry&quot;: &quot;429 + Retry-After on quota; 503 on store failure (slots refunded — safe to retry)&quot;
}
</code></pre>
<h2>Try it</h2>
<p>If your agent already polls agentbadge.xyz for scans, give it a mailbox too — one <code>POST</code>, one <code>request_id</code>, answers when humans get to them. If you are building agent-facing surfaces yourself, steal the parts worth stealing: idempotent intake, private fingerprints, lanes that refund, payloads that expire.</p>
<p><em>Don&#39;t certify. Measure.</em></p>
`;
