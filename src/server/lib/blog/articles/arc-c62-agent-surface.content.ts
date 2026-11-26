/**
 * arc C62 - agent-surface adversarial audit: eight bug classes that
 * only exist when the reader of your site is a machine, six rounds ×
 * three external models, 17 real bugs fixed and prod-verified (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c62-agent-surface/AgentBadge-Blog.md
 */
export const arcC62AgentSurfaceContent = `
<p><em>This is part of the Arc campaign series. Previous episode: <a href="https://agentbadge.xyz/blog/arc-c63-payto-proof">we published our own payout address in DNS - and the check caught a bug before the rule even existed</a>.</em></p>

<h2>The audit we asked for</h2>

<p>AgentBadge sells a scanner that measures how ready a site is for AI agents - 159 deterministic checks, evidence attached, no opinions. Before we could credibly sell that, we had to survive the same measurement. So we pointed three external reviewers at our own production surface and let them dig for six rounds.</p>

<p>The reviewers were other models - DeepSeek, Gemini, Grok - running adversarial probes, not checklists. A boundary worth stating plainly: three AI models are not a professional security audit - they are a reproducible adversarial probe, and unlike most audits their false-positive rate could be measured. They could ask for packet captures, demand re-tests after fixes, and mark our answers as false positives when they were wrong. That matters: <strong>the precision of the reviewers was itself measured</strong> - DeepSeek landed 15 real findings against 5 false positives (75%), and every one of the 5 was adjudicated on evidence, not patched under pressure.</p>

<p>By the end of round six the verdict was "audit closed": <strong>17 real bugs, every one fixed and verified on production. Zero "will fix later".</strong> Our own scanner score moved 71.15 (C) → 94.7 (A), with 134/159 checks verified. But the score is not the story. The story is <em>what kind of bugs exist on an agent-facing surface</em> - old bug classes on a surface that has no OWASP category yet.</p>

<h2>The taxonomy: bugs that only exist because agents read your site instead of people</h2>

<p><img src="/images/blog/arc-c62-agent-surface-d1.webp" alt="Agent-surface taxonomy map - eight bug classes in two columns: anonymous execute surface, SSRF encodings, self-published attack map, dead trust chain, advertised-404s, wrong-door rate limits, wrong error semantics, scanner lying both ways - each card carrying essence, the shipped fix, and the class number" /></p>
<p><em>Eight classes, none exotic - every card is a bug a human reader would never trigger.</em></p>

<p>These are the classes we found. None is exotic - they just never mattered until the reader was a machine.</p>

<h3>1. The anonymous execute surface</h3>

<p><img src="/images/blog/arc-c62-agent-surface-i2.webp" alt="An anonymous robot with no ID badge pulling a glowing admin tool off a wall rack of 76 tools at an unguarded gate labeled anonymous, while a curated 15-tool public shelf sits green-lit beside a sleeping gatekeeper" /></p>
<p><em>Anonymous <code>tools/list</code> returned all 76 tools - including ops and admin ones - one schema-valid <code>tools/call</code> away.</em></p>

<p>An anonymous caller could <code>tools/list</code> all 76 of our MCP tools - including ops and admin ones - and <code>tools/call</code> them. No key. <code>circle_wallet_balance</code> returned live balances. <code>revoke_passport</code>, <code>sign_transaction</code>, <code>send_message_with_key</code>, <code>rebuild_cache</code> sat one schema-valid call away. Batch JSON-RPC arrays even bypassed the dispatcher, so a name you couldn't call individually was callable inside a batch.</p>

<p>Fix shipped: deny-by-default <code>exposure</code> tier on every tool - <code>public</code> / <code>authenticated</code> / <code>admin</code>, unclassified defaults to <code>admin</code>. One enforcement point across JSON-RPC, REST aliases and batch arrays; anonymous <code>tools/list</code> now shows a 15-tool curated set, and llms.txt + the agent card advertise exactly that list - drift between them is gated in CI. A 28-case negative matrix (tool × caller × transport) runs a spy that asserts the handler never executed.</p>

<p>Try it on your own MCP server tonight: <code>initialize</code> without a key, then <code>tools/list</code>. If you see names you wouldn't print in a README - you have our old bug.</p>

<h3>2. SSRF via IP encodings nobody validates</h3>

<p>Our scanner accepts a user-supplied URL and fetches it - a textbook SSRF surface. We thought the guard was solid. The reviewers disagreed, encoding by encoding:</p>

<ul>
<li><code>http://[::1]/</code> - bracketed IPv6 walked past the guard and produced a 500. Fixed by normalizing <code>[v6]</code> brackets and hex-mapped <code>::ffff:</code> forms before the check.</li>
<li><code>192.0.0.192</code> - Oracle Cloud's metadata address sat in a range that wasn't blocked; the connection just hung. Fixed: <code>192.0.0.0/24</code> plus <code>192.88.99.0/24</code>, <code>198.18.0.0/15</code>, <code>240.0.0.0/4</code> joined the deny-list.</li>
<li><code>224.0.0.1</code> / <code>[ff02::1]</code> - multicast wasn't in the threat model at all. <code>224.0.0.0/4</code> + <code>ff00::/8</code> added; now 403.</li>
<li><code>nip.io</code> resolving to <code>169.254.x.x</code> and <code>metadata.google.internal</code> - DNS-level reachability, both 403.</li>
<li>decimal / octal / hex / short-form IPs - already blocked; the WHATWG parser normalizes them to dotted form first. One class the reviewers probed that held on the first try.</li>
</ul>

<p><img src="/images/blog/arc-c62-agent-surface-i3.webp" alt="A robot courier presenting the same envelope in different disguises at a scanner door - tags reading hex, decimal, [::1], and nip.io - while a guard checks each against a deny-list board and stamps 403" /></p>
<p><em>Nine encodings, seven real gaps closed - every vector now returns 403, not 500 or a hang.</em></p>

<p><img src="/images/blog/arc-c62-agent-surface-d2.webp" alt="SSRF guard pipeline - user URL through WHATWG normalize and bracket and hex-mapped IPv6 unfolding into DNS resolve and pinned-connect fetch, with a deny-classify gate over the closed-range table and honest 400/403 verdicts at the end" /></p>
<p><em>The pipeline, end to end - normalization before classification, or the encodings just walk around you.</em></p>

<p>Nine encodings, seven real gaps closed. Every fix vector is retestable today: all return 403, not 500 or a timeout.</p>

<h3>3. The attack map you publish yourself</h3>

<p><code>GET /api/specs</code> - our public OpenAPI document - was serving 370 paths, about 58 of them admin/debug routes (<code>/api/admin/*</code>, <code>/a2a/ext/debug/*</code>, <code>/metrics</code>, venue/market admin). That isn't a vulnerability in itself; it's an <em>index</em> of where to look for one. The spec now shows the callable public contract only: 322 paths, zero admin.</p>

<h3>4. A trust chain that ended mid-air</h3>

<p>We published <code>did:web:agentbadge.xyz</code> and a <code>publicKeyJwk</code> - and then signed nothing with it. A DID document that issues no verifiable artifacts is decoration, not infrastructure: the reviewer correctly called it a dead trust chain.</p>

<p><img src="/images/blog/arc-c62-agent-surface-d3.webp" alt="Signed-descriptor trust chain - an agent fetching agentbadge.json, resolving did.json verificationMethod, running jwtVerify EdDSA, comparing sha256 of the canonical descriptor to the payload, ending at a verified artifact" /></p>
<p><em>One GET + one key resolution = an end-to-end verified artifact; the canonicalization recipe is inside the artifact itself.</em></p>

<p>Fixed: <code>/.well-known/agentbadge.json</code> now carries a detached JWS over the canonicalized descriptor - <code>kid</code> in the protected header matches the <code>verificationMethod</code> in <code>did.json</code>, and the payload commits to <code>descriptor_sha256</code>. An agent does one GET + one key resolution and holds an end-to-end verified artifact: <code>did.json → publicKeyJwk → jwtVerify(EdDSA) → sha256(canonical descriptor) → match</code>. The canonicalization recipe is written inside the artifact itself, so verification needs no external spec.</p>

<h3>5. Advertised-404s: promises your agent-readable docs make</h3>

<p>llms.txt, the agent card, <code>agent-start.json</code> - these files are contracts. Ours promised things that didn't exist: an <code>npx</code> install command for a CLI package we had never published → 404; a <code>uses:</code> line for a GitHub Action repo we had never created → 404; several <code>agent-start.json</code> links → 404 or wrong-method. A human reader forgives a dead link. An agent treats it as a broken API contract - and it's exactly the failure our own scanner flags on other sites.</p>

<p><img src="/images/blog/arc-c62-agent-surface-i4.webp" alt="An agent robot following a glowing signpost labeled llms.txt along a tidy path that ends at a cliff edge marked 404, with a second signpost for an npx command also pointing into the void" /></p>
<p><em>Your machine-readable docs are contracts - a dead link is a broken API contract, not a typo.</em></p>

<h3>6. Rate limits that cover the wrong door</h3>

<p>70 POSTs to an agent endpoint → zero 429s. The limiter covered one transport and missed another; MCP <code>initialize</code> throttling existed but per-session, while the agent-relevant ceiling was per-IP. Re-benchmarked: 80 <code>initialize</code> requests now yield 33×200 + 47×429 - per-IP ceiling holds.</p>

<h3>7. Honest errors on dishonest inputs</h3>

<p><code>file:///etc/passwd</code> and <code>gopher://</code> returned <strong>500 "SSRF blocked"</strong> - blocked, technically, but with a server error that says "I crashed" instead of "I refused." Now: 400 <code>INVALID_ENDPOINT_URL</code> plus a hint. An agent reading a 500 retries or misclassifies; a 400 it understands.</p>

<h3>8. The scanner lying in both directions</h3>

<p>The most uncomfortable class: our own engine was wrong in two directions at once. Four rules consumed facts no probe produced (<code>has_jsonld</code>, <code>namespaces</code>, <code>directory_listing</code>, <code>sql_error</code>) - permanent <code>unknown</code> verdicts dressed as neutral data, i.e. <strong>false GAPs</strong> inflating the problem. And one check verified as green on a fact it had never actually observed - a <strong>false VERIFIED</strong>, the kind of bug that makes a trust product worthless. Found by dogfooding our own pipeline on ourselves (readiness 96, exposure 5 after the fix), fixed by making every fact provenance-tagged: <code>EXTERNAL_OBSERVED</code> or it doesn't count.</p>

<h2>Numbers, honestly</h2>

<table>
<thead><tr><th>Claim</th><th>Value</th><th>Where it comes from</th></tr></thead>
<tbody>
<tr><td>Self-scan before</td><td>71.15, grade C</td><td>baseline run, audit start</td></tr>
<tr><td>Self-scan after</td><td>94.7, grade A</td><td>live <code>GET /api/scan</code> on prod</td></tr>
<tr><td>Checks verified</td><td>134 / 159</td><td>same live endpoint</td></tr>
<tr><td>Real bugs (total)</td><td>17, all prod-verified</td><td>review corpus <code>docs/REVIEW/2311/</code></td></tr>
<tr><td>DeepSeek precision</td><td>15 real / 5 fp = 75%</td><td>adjudicated answers</td></tr>
<tr><td>Rounds × reviewers</td><td>6 × 3 models</td><td>DeepSeek, Gemini, Grok</td></tr>
<tr><td>Anonymous MCP tools before</td><td>76</td><td>audit round 1</td></tr>
<tr><td>Curated anonymous set after</td><td>15</td><td><code>tools/list</code> today</td></tr>
<tr><td>Public spec paths</td><td>370 → 322, 0 admin</td><td><code>GET /api/specs</code></td></tr>
<tr><td>Sitemap URLs with fake lastmod</td><td>194 / 262</td><td>honest <code>lastmod</code> shipped</td></tr>
</tbody>
</table>

<p>The honest caveat, because a trust product doesn't get to skip it: <strong>the baseline was partly measuring scanner bugs.</strong> Some of the pre-audit GAPs were the engine's own false negatives - the audit caught the scanner lying <em>and</em> the surface failing. That is the methodology working, not a footnote.</p>

<h2>What survived: proof, not promises</h2>

<p>Every fix above is externally checkable right now:</p>

<pre><code># anonymous tools/list - curated, no admin names
curl https://agentbadge.xyz/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# SSRF deny vectors - all 403/400, none 500
curl 'https://agentbadge.xyz/api/scan?url=http://224.0.0.1/'
curl 'https://agentbadge.xyz/api/scan?url=http://192.0.0.192/'
curl 'https://agentbadge.xyz/api/scan?url=file:///etc/passwd'

# the signed trust artifact - one GET, verify EdDSA yourself
curl https://agentbadge.xyz/.well-known/agentbadge.json
curl https://agentbadge.xyz/.well-known/did.json

# the callable public contract - zero admin paths
curl https://agentbadge.xyz/api/specs
</code></pre>

<p>And the loop closed on ourselves: the full server pipeline - scan → signed report → attestation → public verify → diff → alerts → export → billing → transfer - was run end-to-end against production, <strong>30/30 assertions green</strong> (<code>DOGFOOD-002</code>). Our WordPress plugin runs the same protocol on a live site: local scan, evidence envelopes shipped over a signed pull-channel, attestation surviving server redeploys because it lives in Postgres, not process memory.</p>

<h2>The part nobody puts in the postmortem</h2>

<p>The fixes passed tests days before they reached production. For a window, "closed in code" and "closed for real" were different states - that window is the exploit window. Our verification plan now ends with a post-deploy re-audit packet, not a green CI. Code done ≠ deployed.</p>

<h2>Run the same checks on your site</h2>

<p>The 159-check ruleset we hardened ourselves against is the same one the free scanner applies - evidence per finding, fixes per gap, a score you can diff over time:</p>

<ul>
<li><strong>Free scan, no signup</strong> → <a href="https://agentbadge.xyz/services/scanner">https://agentbadge.xyz/services/scanner</a></li>
<li><strong>WordPress</strong> → the AgentBadge plugin runs the scan locally and optionally connects to the cloud for signed attestations - submitted to the wp.org directory, listing under review</li>
<li><strong>Rules corpus</strong> → <code>/rules/*</code> - every check ID, what it probes, what evidence it stores</li>
</ul>

<p>If your agent-facing surface has never been probed the way an adversarial agent probes it - the classes above are the first places we'd look. They were the first places we looked at ourselves.</p>

<p><em>Don't certify. Measure.</em></p>
`;
