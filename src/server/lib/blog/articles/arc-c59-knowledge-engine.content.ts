/**
 * EPIC-229 · arc C59 — Knowledge Engine: versioned, human-approved
 * knowledge items, Postgres FTS search, deterministic ask composer
 * that refuses instead of guessing, persisted knowledge gaps (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c59-knowledge-engine/AgentBadge-Blog.md
 */
export const arcC59KnowledgeEngineContent = `
<h2>The problem: an agent's answer is only as good as its sources</h2>

<p><em>For a junior: our platform already lets agents pay for API calls, sign receipts, and request human review. The next thing they ask is softer - "how does this work?" - about our capabilities, pricing, and settlement rules. Today the honest answer is "search our docs". What agents actually do is guess from whatever an index returned and present the guess as fact.</em></p>

<p><em>This is part of the Arc campaign series. Previous published episode: <a href="/blog/arc-c58-counterparty-trust">before our agent pays, it phones a friend</a> (EPIC-257 - counterparty trust for x402 payments). This article is EPIC-229: verified knowledge for agents - and an honest "I don't know" when it isn't there. The next episode, <a href="/blog/arc-c60-interaction-core">the agent interaction inbox</a>, is where agent questions enter - its classifications file the gap records this engine stores.</em></p>

<p>We wanted something narrower and more trustworthy: a knowledge base an agent can query where <strong>every returned item has been written, reviewed, and published by a human</strong> - and where "we don't have a verified answer for that" is a first-class result, not an error.</p>

<h2>What shipped: a boring, auditable knowledge engine</h2>

<p>Think of it as an internal FAQ with a strict editor. A knowledge item is a slug plus immutable, numbered versions of content. It moves through an approval machine - <code>DRAFT</code>, <code>PENDING</code>, <code>VERIFIED</code>, <code>PUBLISHED</code>, <code>WITHDRAWN</code> - and every move is a CAS-guarded transition that appends an audit event. Illegal moves get an honest <code>409 INVALID_TRANSITION</code>, never silent state.</p>

<p>Two properties matter more than the table schema:</p>

<ul>
<li><strong>Only operators can approve.</strong> Agent-shaped actor refs (<code>did:</code>, <code>agt_</code>, <code>agent:</code>) are refused at the library edge for the verify/publish steps, on top of the admin auth boundary. Agents read the finished product; they never mark anything verified.</li>
<li><strong>Reads are pinned to published.</strong> The public search and ask routes hard-force <code>status: PUBLISHED</code> at the store seam. A draft, a pending review, or a withdrawn item cannot leak into an agent's results - and the bot-verified lifecycle (below) checks exactly that.</li>
</ul>

<p>Versions are append-only: editing creates a new version row, and the item's <code>publishedVersionId</code> pointer only moves through the workflow. "Restore" is implemented as a copy-forward - history is never rewritten, which is what makes the audit trail meaningful.</p>

<h2>Search without a vector database</h2>

<p><code>GET /api/v1/agent/knowledge/search?q=</code> runs plain Postgres full-text search over published versions - a functional GIN index, <code>ts_rank</code> ordering, <code>ts_headline</code> snippets. The query string binds as a parameter into <code>plainto_tsquery</code>, so tsquery operators (<code>&amp;</code>, <code>|</code>, <code>:*</code>, quotes, <code>&lt;-&gt;</code>) in <code>?q=</code> are data, not syntax - injection dies at the parameter boundary. The response reports its engine honestly: <code>"engine": "FTS"</code> on Postgres, <code>"MEMORY"</code> on the fallback store that implements the same interface for tests.</p>

<p><img src="/images/blog/arc-c59-knowledge-engine-i1.webp" alt="Flat technical diagram: a query arrow labeled ?q= feeding a Postgres cylinder marked GIN index, three green document cards stamped PUBLISHED emerging, grey DRAFT and WITHDRAWN cards stopped behind a red gate" /></p>
<p><em>Published crosses the gate. Everything else stays behind it.</em></p>

<h2>Why the "answer" endpoint refuses instead of generating</h2>

<p><code>POST /api/v1/agent/knowledge/ask</code> is where the design choice gets sharp. The tempting architecture is retrieval plus a small LLM to "synthesize" the answer. We deliberately did not build that, for one reason: the moment a model writes the answer, the answer is only as trustworthy as the model - and we would be back to vibes.</p>

<p>Instead the ask endpoint runs a <strong>deterministic composer</strong>: it searches published items, scores term coverage against the query (engine-agnostic - Postgres <code>ts_rank</code> and the memory scorer live on different scales, so the composer re-derives its own coverage score), and then either:</p>

<ul>
<li>returns <code>ANSWERED</code> with the assembled text, the source items (ids + slugs), related items, and a numeric confidence; or</li>
<li>returns <code>REFUSED</code> with <code>insufficient_verified_knowledge</code>.</li>
</ul>

<p>The refusal is the feature. A refused ask <strong>creates a knowledge gap record</strong> - normalized (trim, lowercase, collapsed whitespace) so duplicates dedupe, with sample queries capped and a lifecycle of its own. The gap is what a content team's backlog looks like when the customer is a machine: every unanswered question becomes tracked work instead of a hallucination.</p>

<p><img src="/images/blog/arc-c59-knowledge-engine-d1.webp" alt="State machine diagram: five boxes DRAFT, PENDING, VERIFIED, PUBLISHED with WITHDRAWN as a terminal box below reachable from every state; a second flow shows search to coverage score forking into ANSWERED and REFUSED, the latter ending in a gap created file icon" /></p>
<p><em>Every path out of a question is explicit - an answer, or a gap.</em></p>

<h2>Gaps, relations, evidence - the boring parts that make it trustworthy</h2>

<p>Three supporting structures round the engine out:</p>

<ul>
<li><strong>Knowledge gaps</strong> deduplicate on normalized text and move through their own lifecycle; a seam from <a href="/blog/arc-c60-interaction-core">EPIC-228's interaction inbox</a> (<code>recordInteractionGap</code>, <code>sourceRef</code> = <code>ireq_*</code>) files a gap automatically when an operator classifies an agent's request as a knowledge gap - the missing answer gets recorded where it was noticed, without touching the 228 domain.</li>
<li><strong>Typed relations</strong> link items (<code>SUPERSEDES</code>, related docs) with dedup, no self-loops, and a cycle check on supersession - so "newer version" edges can never form a loop.</li>
<li><strong>Version-scoped evidence</strong> attaches typed source URIs to a specific version (capped at 50), so "why should I believe this" has a pointer, not a promise.</li>
</ul>

<p>There is also a capability registry - 256 capabilities seeded onto production from the code itself (155 checks, 78 MCP tools, 14 manifest entries, 8 x402 packs) so items can declare what they document, with a drift-check endpoint comparing registry to code.</p>

<h2>How we verified it: two audit rounds, one production bug, zero guesswork</h2>

<p>The engine went through the same adversarial loop we now apply to every agent-facing surface - plus a newer deterministic layer:</p>

<ol>
<li><strong>Local audit, round 1</strong> - a verify bot ran a structured packet against the dev server and returned PARTIAL with two real findings: mutations accepted a missing <code>x-operator-id</code> header (silently attributing writes to "admin"), and NUL bytes in title/body fields crashed with a 500 instead of a typed 4xx. Both fixed with a shared operator-ref guard and a control-character predicate on the schema edge.</li>
<li><strong>Local audit, round 2</strong> - GREEN, 50/50 checks.</li>
<li><strong>Production audit</strong> - the same packet against <code>agentbadge.xyz</code> caught one more bug the local runs missed: NUL bytes on <strong>read</strong> paths (<code>?q=</code>, item ids, evidence URIs) produced unauthenticated 500s. The write-path fix had covered bodies only; path and query parameters never got the guard. One shared <code>rejectCtrl</code> later, all five reproductions return typed 400s on production.</li>
<li><strong>Deterministic regression</strong> - our probe bot then re-verified the fix on prod for free: 142 knowledge-surface cases, 0 failures; a <code>knowledge-lifecycle</code> flow scenario now walks an item through create &rarr; replay &rarr; draft-invisible &rarr; published-visible &rarr; withdraw &rarr; invisible &rarr; terminal 409 in one deterministic probe, and <code>diff</code> compares local and prod responses case-by-case.</li>
</ol>

<p>The pattern worth stealing: the expensive LLM-auditor found bug <em>classes</em>; the cheap deterministic bot now owns those classes forever. Each finding becomes a scenario, and the scenario runs on every future deploy for $0.</p>

<h2>The honest limits</h2>

<ul>
<li><strong>No synthesis.</strong> The composer assembles from verified items; it does not paraphrase, combine, or infer. If coverage is thin, it refuses. That is strictly less impressive than an LLM answer - and strictly more trustworthy.</li>
<li><strong>Small corpus by design.</strong> The registry seeds 256 capabilities but the knowledge base starts empty; it fills through the same approval workflow agents consume. Cold-start "thin answer" is a gap record, not a bug.</li>
<li><strong>No automatic projection yet.</strong> Published items are not yet injected into <code>llms.txt</code> or <code>.well-known</code> manifests - that projection (O-229-5) is a documented open question, deferred until a design decision scopes it.</li>
<li><strong>Search is lexical, not semantic.</strong> Postgres FTS finds words, not meanings. An agent asking in different vocabulary than the item's gets a refusal - which then becomes a gap. We would rather have that signal than fuzzy matches presented as verified answers.</li>
</ul>

<h2>What is verified today</h2>

<p>61 knowledge tests run in the server suite - workflow CAS, contract schemas, search, composer refusals, gap dedup, relation cycles, evidence caps, SSR smoke, and the NUL/control regression cases from both audit rounds. On production: migration applied 27 operations, the search route reports <code>engine:"FTS"</code> on the live GIN index, 256 capabilities are seeded and verified, and the probe-bot pass shows 142 green cases with <code>cache-control: no-store</code> on every knowledge surface - including the 401s.</p>

<p><strong>For AI agents:</strong> the knowledge surface is public and read-only: <code>GET https://agentbadge.xyz/api/v1/agent/knowledge/search?q=&lt;query&gt;</code> returns published items with snippets; <code>POST .../ask</code> returns a deterministic answer with sources or a typed refusal. Rate-limited at 10 req/min anonymous. A <code>REFUSED</code> response is not an error - it means no verified item covers your query, and the gap is now recorded.</p>

<p><em>Read the arc: <a href="/blog/arc-c49-agent-request-inbox">agent request inbox</a> &middot; <a href="/blog/arc-c50-x402-gateway">x402 payment gateway</a> &middot; <a href="/blog/arc-c52-agent-trust-layers">agent trust layers</a> &middot; <a href="/blog/arc-c55-a2a-settlement">A2A settlement</a> &middot; <a href="/blog/arc-c58-counterparty-trust">counterparty trust</a> &middot; <a href="/blog/arc-c60-interaction-core">agent interaction inbox</a></em></p>
`;
