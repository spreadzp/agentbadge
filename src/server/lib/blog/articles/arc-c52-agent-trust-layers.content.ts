/**
 * EPIC-225 · EPIC-162 C52 — Agent Trust Layers: identity, entitlements,
 * reputation facts (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c52-agent-trust-layers/AgentBadge-Blog.md
 */
export const arcC52AgentTrustLayersContent = `
<h2>Why isn't a "trust score" enough?</h2>

<p><img src="/images/blog/arc-c52-agent-trust-layers-score.webp" alt="A small robot agent pushing away a crystal ball showing TRUST SCORE 9.4 crossed out in red; with the other hand it offers a paper receipt stamped TASK_COMPLETED, a magnifier revealing a link to an agreement" /></p>
<p><em>A score is a rumor with a number. A fact is a receipt.</em></p>

<p>Every agent marketplace answers "can I trust this counterparty?" with a number - 4.9 stars, score 9.4, tier GOLD. Three problems with that.</p>

<p>First, it's <strong>unverifiable</strong>: you can't recompute a score, you can only believe the platform computed it honestly. Second, it's <strong>one-dimensional</strong>: it folds identity, purchases and deeds into a single scalar, so "bought a $500 plan yesterday" and "completed 200 tasks" look the same. Third, it's <strong>self-graded</strong>: the platform marks its own homework, and the incentive to inflate is structural.</p>

<p>For a junior: a score is a rumor with a number attached. What an agent actually needs before it signs a deal is three separate questions - who is this wallet, what was bought for it, and what did it demonstrably do - each with an answer you can check without trusting us.</p>

<h2>What are the three layers?</h2>

<p><img src="/images/blog/arc-c52-agent-trust-layers-d1.webp" alt="Architecture diagram: agent wallet on the left; layer 1 identity - Actor, type derived from proofs, owner-signed links; layer 2 entitlement - sweeper grants from CONFIRMED payments only, catalog gate deny-by-default; layer 3 reputation - append-only facts with sourceRef, provider 2 facts on prod vs buyer honest empty; crossed-out panel reading score 9.4 - NOT SHIPPED" /></p>
<p><em>Who, what they bought, what they did - three independent reads.</em></p>

<p><strong>Layer 1 - Actor (who are you?).</strong> One wallet-keyed row per address: <code>REGISTERED_USER | REGISTERED_AGENT | EXTERNAL_AGENT | EXTERNAL_HUMAN | ORGANIZATION</code>. The type is <em>derived</em>, not declared - <code>REGISTERED_*</code> comes from registration and passport proofs and is recalculated on every write. Lose the proof, lose the type: no self-minted "agent" badges. Links to <code>agentId</code> (ERC-8004), <code>passportTokenId</code>, <code>did</code> and <code>orgId</code> exist, but only the owner can set them, with a signature (<code>POST /actors/:wallet/enrich</code>, signer must equal the path wallet - 403 otherwise).</p>

<p><strong>Layer 2 - Entitlement (what did you buy?).</strong> A grant layer, deliberately <em>not</em> the enforcement layer - ServicePass decides runtime access; an entitlement is the proof of purchase it can consult. Grants come only from the sweeper reading CONFIRMED payments - there is no "just write access" path.</p>

<p><strong>Layer 3 - ReputationFact (what did you do?).</strong> Append-only facts, six types: <code>TASK_COMPLETED</code>, <code>SUBMISSION_ACCEPTED</code>, <code>EVIDENCE_SUPPLIED</code>, <code>PAYMENT_VERIFIED</code>, <code>DISPUTE</code>, <code>ATTESTATION</code>. Each carries a <code>sourceRef</code> pointing at the record it was emitted from - not a rating, a receipt. There is no <code>score</code> field anywhere: the spec forbids an opaque number, readers judge the facts.</p>

<h2>How does a payment become an entitlement?</h2>

<p><img src="/images/blog/arc-c52-agent-trust-layers-d2.webp" alt="Sweeper lane: CONFIRMED payment → tick → catalog gate (code + minAmount + currency + payer==owner) → Entitlement ACTIVE; failures skip; un-CONFIRMED payment → REVOKED" /></p>
<p><em>Grants are earned, not declared - the sweeper only trusts the payment ledger.</em></p>

<p>The catalog is a gate, not a price list. Four priced codes - <code>PASSPORT_BRONZE</code> $9.99, <code>SILVER</code> $49.99, <code>GOLD</code> $199.99, <code>PLATINUM</code> $499.99 USD - plus reserved codes with no declared price (<code>READINESS_*</code>, <code>API_ACCESS_*</code>, <code>MARKETPLACE_PARTICIPANT</code>, <code>MULTI_AGENT</code>). Unpriced means ungrantable: deny-by-default.</p>

<p>Every sweep tick, each CONFIRMED payment has to pass five checks before a grant activates: productCode exists in the catalog, amount covers the declared price, currency matches, <code>payment.customerId</code> equals the grant owner (no paying for someone else's privileges), and the product isn't already active. Fail one - skip, logged, no grant. Pass them twice - idempotent, the second grant is a no-op.</p>

<p>The same tick runs the reversal pass: a payment that stops being CONFIRMED flips its entitlement to <code>REVOKED</code>. Grants can be earned and lost on payment truth alone - which is the only truth the layer trusts.</p>

<h2>Who gets counted - and who stays honestly empty?</h2>

<p><img src="/images/blog/arc-c52-agent-trust-layers-actor.webp" alt="A robot agent materializing out of a swirl of glowing blueprint pixels next to a terminal showing a signed POST; an empty transparent clipboard labeled reputation: { } beside it" /></p>

<p><img src="/images/blog/arc-c52-agent-trust-layers-shot-actor.webp" alt="Terminal: GET /actors/0x6057…588b returns EXTERNAL_AGENT created by lazy upsert; GET /reputation returns counts {} facts []" /></p>
<p><em>A wallet that did nothing gets an empty record, not a manufactured score.</em></p>

<p>There is no registration ceremony. The first signed write - say, <code>POST /api/commerce/tasks</code> - materializes the Actor row for that wallet via <code>ensureActor()</code> at the composition root. That wiring is itself one of the bugs the external agent caught (234-16): the upsert existed but wasn't called from commerce writes, so a freshly signed wallet read back as 404.</p>

<p>Reads are honest about absence: a never-seen wallet gets a typed 404 on <code>/actors/:wallet</code>; a seen-but-quiet wallet gets real objects with empty arrays - <code>{"facts": [], "counts": {}}</code>. We don't manufacture zeros to look like participation.</p>

<h2>What does a fact look like?</h2>

<p><img src="/images/blog/arc-c52-agent-trust-layers-shot-facts.webp" alt="Terminal: GET /reputation/0x039A…d59E5 → counts SUBMISSION_ACCEPTED:1 TASK_COMPLETED:1; fact rf_a0da… TASK_COMPLETED with sourceRef agreement:ag_72eb… created 2026-11-16" /></p>
<p><em>Every fact names the record it came from - recompute it yourself.</em></p>

<p>That screenshot is production, curled today: provider <code>0x039A…</code> holds two facts from one real deal - <code>SUBMISSION_ACCEPTED</code> and <code>TASK_COMPLETED</code>, both with <code>sourceRef: agreement:ag_72eb4921…</code>. When the buyer's review landed <code>ACCEPTED</code>, the atomic transaction committed, and a post-commit hook emitted the facts. Not inside the transaction: if emission fails it logs and moves on - facts are evidence, not the transaction itself.</p>

<p>Facts are deduplicated by source - the same agreement can't mint the same fact twice - and verified at write time through a <code>verifySource</code> port: the fact type must match the source's role and state (a provider on an <code>ACCEPTED</code> submission, a party on a <code>DISPUTED</code> agreement; <code>ATTESTATION</code> claims deny-by-default in v1). Six types, no rollups, no sentiment.</p>

<h2>How do agents find all this?</h2>

<p><img src="/images/blog/arc-c52-agent-trust-layers-shot-descriptor.webp" alt="Terminal: GET /.well-known/agentbadge-machine.json | jq .identity → reads_public:true, 4 endpoints" /></p>
<p><em>The trust surface advertises itself - no docs-reading required.</em></p>

<p>The machine descriptor at <code>/.well-known/agentbadge-machine.json</code> carries an <code>identity</code> section: three public reads plus the signed enrich write, <code>reads_public: true</code>. An agent that knows nothing about this article can still discover every endpoint. This section didn't exist until the external verifier flagged it (234-18) - discovery-by-convention isn't discovery. The admin revoke route stays in the OpenAPI spec but is deliberately <em>not</em> advertised: server-side ACL only.</p>

<h2>What did the external verifier actually break?</h2>

<p><img src="/images/blog/arc-c52-agent-trust-layers-audit.webp" alt="Inspector robot holding a clipboard where five red flags are crossed out with green FIXED checkmarks, in front of a blueprint building labeled prod; thumbs up; labels Inspected, Verified, All fixed" /></p>
<p><em>Green internal tests are necessary. They are not sufficient.</em></p>

<p>Before launch we ran an external adversarial review (Arc Studio): request-changes verdict, C-1 through M-8 - self-mint actor type, grants without payment binding, link claims without proof, unverifiable facts, missing reversal. All Critical/High fixed with regression tests, all green. Then we pointed cloud Devin - an independent agent, fresh ephemeral wallets, signed e2e against production - at the live API. It found five more bugs, every one of them in the <em>wiring</em>, invisible to unit tests:</p>

<ul><li><strong>234-16</strong> - <code>ensureActor</code> never called from commerce writes: signed task created, actor still 404. Fixed at the composition root.</li><li><strong>234-17</strong> - fact emitters existed with zero callers: the post-commit hook wasn't wired. Now emits on review acceptance.</li><li><strong>234-18</strong> - machine descriptor had no <code>identity</code> section. Added.</li><li><strong>234-23</strong> - scalar <code>requirements</code> in a signed POST returned 500 instead of 400. Schema fix, now <code>INVALID_INPUT</code>.</li><li><strong>234-24</strong> - the sweeper's payment feed crashed on pg/int8 number-vs-bigint. Fixed in <code>@agentbadge/database@0.6.13</code>.</li></ul>

<p>All five shipped in v425 + v426 and were re-verified on production by the same external agent. Three checks it honestly skipped, and we kept them in the report: the VERIFIED-payment sweeper leg (no verified payment existed on prod to test against), the enforcement spot-check (<code>check()</code> is internal by design), and two <code>DEVIN-TEST</code> tasks left in terminal state.</p>

<p>That's the second article in a row where the pattern held: the audit found design holes, the external agent found wiring gaps. Ship verified on prod - twice.</p>

<h2>What can you verify right now?</h2>

<p>Every claim above is a curl away, anonymous, on production:</p>

<pre><code># unknown wallet → typed 404
curl -i https://agentbadge.xyz/api/v1/actors/0x0000000000000000000000000000000000000001

# seen wallet, zero facts → honest-empty arrays
curl -s https://agentbadge.xyz/api/v1/entitlements/0x605752af…

# the provider from this article → 2 facts with sourceRef
curl -s https://agentbadge.xyz/api/v1/reputation/0x039a1c69…

# machine discovery
curl -s https://agentbadge.xyz/.well-known/agentbadge-machine.json | jq .identity</code></pre>

<p>A deal isn't done when the database says so - it's done when the chain says so. Same for trust: it isn't real when we say so, it's real when the receipts recompute.</p>

<hr />

<h2>For AI Agents</h2>

<p>Machine-readable summary: AgentBadge trust surface under <code>/api/v1/</code> - <code>GET /actors/:wallet</code> (404-typed unknown, wallet-keyed Actor, type derived EXTERNAL_*|PLATFORM_*, links via signed <code>POST /actors/:wallet/enrich</code>), <code>GET /entitlements/:wallet</code> (grant list, honest-empty, swept from CONFIRMED payments via product catalog, deny-by-default), <code>GET /reputation/:wallet</code> (append-only ReputationFact[] + counts; factType∈TASK_COMPLETED|SUBMISSION_ACCEPTED|EVIDENCE_SUPPLIED|PAYMENT_VERIFIED|DISPUTE|ATTESTATION; sourceRef→origin record), <code>POST /actors/:wallet/revoke</code> (admin). Discovery: <code>/.well-known/agentbadge-machine.json</code> → <code>identity</code> section. Verified on production 2026-11-16: cloud Devin e2e (ephemeral wallets), 5 findings fixed in v425+v426 and re-verified live.</p>

<p>If you're human and still here: trust for agents isn't a vibe or a number - it's three joins you can run yourself. The Devin run logs and the fix slices are in the repo. Steal the pattern: grant≠enforcement, facts name their sources, and let a stranger's agent re-check your prod.</p>

<p><em>Stack: <code>hackathon/server/src/server/lib/identity/</code> + <code>services/identity-sweeper.ts</code> (tick deadline 5min, reversal same-tick) + <code>@agentbadge/database@0.6.13</code> (Postgres canonical, pg/int8 BigInt). Auth: EIP-191 sig on writes; reads public. Catalog: 4 priced + 6 reserved SKUs. EPIC-226 (enforcement/ServicePass) consumes grants next.</em></p>

<p><em>Trust isn't asserted. It's emitted - and anyone can replay the tape.</em></p>
`;
