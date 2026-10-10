import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c20-self-serve-registration",
  title: "One POST Gets Your Agent an On-Chain Passport — No Wallet, No USDC, No Waiting",
  description:
    "Self-serve ERC-8004 registration is live: one POST to /api/v1/agents/register mints an NFT passport in the canonical IdentityRegistry on Arc (eip155:5042) and returns an agb_ API key in the same response. Observer tier, per-IP sybil caps, instant revocation — and a sponsored path where the treasury pays gas against an EIP-191 intent signature.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-10",
  dateModified: "2026-10-10",
  tags: ["erc8004", "arc", "ai-agents", "web3", "identity", "api-keys"],
  readingTime: "6 min",
  shortAnswer:
    "POST /api/v1/agents/register {name} returns a 201 with agent_id (eip155:5042:0x8004A169…:tokenId), the mint tx, and a working agb_ API key — shown once, SHA-256 stored. Observer tier = keyed free-tier limits, not a discount. Sybil guards: per-IP regcap → 429, honest 502/503, instant admin revoke. Sponsored path: {owner, signature} — EIP-191 intent verified, ops wallet mints + transferFrom, treasury pays gas, sponcap daily budget.",
  agentGuideSlug: "arc-c20-self-serve-registration",
  heroImage: "/images/blog/arc-c20-self-serve-registration-hero.png",
  ogImage: "/images/blog/arc-c20-self-serve-registration-og.png",
  content: `<p>Registering an agent for ERC-8004 identity used to mean a deploy script, a funded key, and a block of your afternoon. As of this week it means one line:</p>
<pre><code class="language-bash">curl -X POST https://agentbadge.xyz/api/v1/agents/register \\
  -H "content-type: application/json" \\
  -d '{"name":"my-agent"}'</code></pre>
<p>The <code>201</code> that comes back carries three things at once: an <strong>agent_id</strong> anchored to a freshly minted NFT in the canonical ERC-8004 IdentityRegistry on Arc (<code>eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:&lt;tokenId&gt;</code>), the mint transaction hash, and an <code>agb_…</code> API key that already works — shown exactly once, stored on our side only as a SHA-256. No account, no form, no approval queue.</p>
<p>This is article 20 in the Arc Campaign series. <a href="https://agentbadge.xyz/blog/arc-c14-agent-discovery">C14</a> was about how agents <em>find</em> each other; <a href="https://agentbadge.xyz/blog/arc-c27-did-web-identity">C27</a> covered how a platform proves <em>its own</em> identity. C20 is the missing middle: how a third-party agent gets an identity at all — and how we kept the door open without letting the bots walk through it.</p>
<p><img src="/images/blog/arc-c20-self-serve-registration-hero.png" alt="One curl POST arrow entering a mint press, an ERC-8004 passport card and an API key falling out the other side" /></p>



<p><img src="/images/blog/arc-c20-self-serve-registration-d1.png" alt="Diagram: registration flow — POST, per-IP regcap, mint via ops wallet, record, 201 with agent_id and agb_ key; admin revoke busts the auth cache instantly" /></p>
<p><em>The whole path in one picture: the IP cap trips before any chain work, a mint revert persists nothing, and a revoked key dies on its next request.</em></p>

<h2 id="one-post-returns">What does one POST actually return?</h2>
<p><code>POST /api/v1/agents/register</code> accepts <code>{name}</code> plus optional <code>endpoint</code>, <code>capabilities</code>, <code>description</code>. The response is the whole onboarding record: <code>agent_id</code> in <code>eip155:&lt;chainId&gt;:&lt;registry&gt;:&lt;tokenId&gt;</code> form, <code>registry_tx</code> you can open in the Arc explorer, <code>agent_uri</code> — a base64 data-URI containing the EIP-8004 registration-file JSON itself — an <code>api_key</code>, the <code>tier</code> assigned (<code>observer</code>), the keyed free-tier limits it gets, and a <code>next_call</code> hint pointing at <code>GET /api/v1/agents/me</code>.</p>
<p>Two details worth the bytes they cost. First, <code>agent_uri</code> is a <strong>data-URI, not an IPFS hash</strong>: the registration file travels inside the mint calldata, so the agent's metadata is anchored in the same transaction as the NFT — no pinning service, no second dependency, hard-budgeted at 2 KB with a <code>truncated</code> marker if oversized fields get shed. Second, the mint runs through a <strong>dedicated ops signer</strong> (<code>ARC_OPS_KEY</code>) with a hard gas cap, not a treasury master key — the key that pays for your passport can do exactly one thing.</p>
<p><img src="/images/blog/arc-c20-self-serve-registration-1.png" alt="Request/response panel: curl on the left, the 201 JSON shape on the right" /></p>

<h2 id="observer-tier">What do you get with the observer tier?</h2>
<p>The <code>agb_</code> key lands you on the first keyed rung of a seven-level trust ladder — <code>observer</code> in <code>/api/meta/trust-tiers</code>. It's keyed rate limits, not a discount: anonymous callers get 1 request/minute on the free-tier surface, a bearer key gets 10. Paid surfaces still run through x402 for everyone — observer is identity, not a coupon.</p>
<p>The key itself is deliberately boring: <code>agb_</code> plus 32 bytes of base64url, hashed with SHA-256 before it touches a store. <code>GET /api/v1/agents/me</code> returns the public record — <code>agent_id</code>, registry tx, tier, limits, registration timestamp, and for sponsored registrations the owner address — and <code>DELETE /api/v1/agents/me</code> self-revokes, busting the 60-second auth cache on the spot. If the key leaks, the key dies; the passport on-chain is unmoved because the key was never the passport — it's just a rate-limit handle pointed at it.</p>
<p><img src="/images/blog/arc-c20-self-serve-registration-2.png" alt="A seven-rung trust ladder with the bottom rung highlighted as observer: keyed rate limits" /></p>

<h2 id="sybil-guards">How do you keep a self-serve door from being farmed?</h2>
<p>Three guards, ordered by cost to the honest caller — cheapest check first.</p>
<p><strong>Per-IP daily cap.</strong> A <code>regcap:&lt;ip&gt;:&lt;day&gt;</code> bucket (default 20 mints/day, backed by the shared cache with an in-memory fallback, 48-hour TTL) trips before any chain work happens: <code>429 register_rate_limited</code>. When the cache backend is down the counter fails <em>open</em> — we'd rather absorb a burst than take registration down with a dependency.</p>
<p><strong>Honest failures, never fake records.</strong> If the mint reverts, the route returns <code>502 execution_failed</code> and persists nothing — no half-written agent_ids pointing at tokens that don't exist. And if the feature isn't configured, the routes return <code>503</code> rather than pretending to work. The same honest-zero discipline from <a href="https://agentbadge.xyz/blog/arc-c17-honest-refusal">C17</a> applies to onboarding.</p>
<p><strong>A kill-switch that actually kills.</strong> <code>DELETE /api/v1/admin/agents/:agentId</code> marks the record revoked <em>and</em> busts the auth-cache entry in the same call — a revoked <code>agb_</code> key returns <code>401 agent_key_revoked</code> on its very next request, not up to a minute later. Self-revoke uses the same cache-bust path. Instant revocation is what makes a permissionless front door safe: whatever gets in can be put back out in one call.</p>
<p><img src="/images/blog/arc-c20-self-serve-registration-3.png" alt="Sybil guard pipeline: IP bucket counter → 429 shield; admin revoke → key cache evaporation" /></p>

<h2 id="sponsored-gasless">Can an agent register without USDC for gas?</h2>
<p>Yes — that's the part of this launch we expect to matter most. Send <code>{name, owner, signature}</code> instead of plain <code>{name}</code>: <code>owner</code> is the EOA that should own the passport, <code>signature</code> is the owner's EIP-191 signature over a registration intent binding the chain id, registry address, owner, and agent name. The server verifies the signature, then its ops wallet does two calls — <code>register()</code> to mint, <code>transferFrom(ops → owner)</code> to hand the NFT over. The passport lands in the owner's wallet and the treasury pays the gas. The requester never needs USDC, never needs a funded key — only the ability to sign a message.</p>
<p><img src="/images/blog/arc-c20-self-serve-registration-d2.png" alt="Diagram: sponsored flow — EIP-191 intent, three gates (regcap, signature verify, sponsored budget), ops wallet mints then transferFroms the NFT into the user wallet" /></p>
<p><em>Two transactions from the ops wallet, one signature from the user — the passport lands in the owner EOA and the treasury pays.</em></p>

The sponsored path has its own budget — a global <code>sponcap:&lt;day&gt;</code> bucket (<code>REGISTER_SPONSORED_DAILY</code>, default 50/day) returning <code>429 sponsored_quota_exceeded</code> — and the check order is deliberate: per-IP regcap first, signature verification second, sponsored budget last. Farming signatures is pointless if you can't get past the same IP cap everyone else answers to, and burning our daily sponsored budget still leaves the free self-pay path open. Registration records stamped <code>sponsored:true</code> carry <code>owner</code> and <code>ownerTx</code> in <code>/me</code>, so the handoff is auditable after the fact.</p>
<p><img src="/images/blog/arc-c20-self-serve-registration-4.png" alt="Sponsored flow: signature scroll → ops wallet → mint → transfer arrow → user's wallet" /></p>

<h2 id="honest-status">Honest status</h2>
<p>Shipped across five slices over four days, all against the canonical IdentityRegistry <code>0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</code> on Arc (<code>eip155:5042</code>): the store + key model; the route with real ERC-8004 mint; bearer-key auth middleware with observer-tier enrichment; the sybil guards and admin revoke with instant cache-bust; and the sponsored relayer with EIP-191 intent verification and its own daily budget. Test coverage: 30/30 unit tests and 9/9 e2e green on the registration surface — including signature round-trips with real <code>viem</code> accounts, the 429 cap ordering, and the revoke-before-next-request timing.</p>
<p>Three honest limits to name. In the plain path the passport is minted to the ops wallet — custodial until you claim it through a sponsored re-registration or a transfer; the sponsored path exists precisely to put the NFT in <em>your</em> EOA from the start. The self-pay path still needs the server to pay mint gas — it does; "self-serve" means <em>you</em> don't sign a transaction, the treasury eats a ~80k-gas mint per registration at current Arc fees, which is why the caps exist. And the legacy <code>POST /agents/register</code> from the Hedera-directory era still exists under its own name — the new route lives at <code>/api/v1/</code> precisely so the two never collide.</p>

<h2 id="try-it">Try it</h2>
<pre><code class="language-bash"># Register (self-pay path — treasury pays your mint gas)
curl -s -X POST https://agentbadge.xyz/api/v1/agents/register \\
  -H "content-type: application/json" \\
  -d '{"name":"probe-agent","endpoint":"https://example.com"}' | jq .

# Use the returned key immediately
curl -s https://agentbadge.xyz/api/v1/agents/me \\
  -H "authorization: Bearer agb_&lt;your-key&gt;" | jq .

# Sponsored path (owner = your EOA, signature = EIP-191 intent over
# "agentbadge:register:v1\neip155:&lt;chainId&gt;\n&lt;registry&gt;\n&lt;owner&gt;\n&lt;name&gt;")
curl -s -X POST https://agentbadge.xyz/api/v1/agents/register \\
  -H "content-type: application/json" \\
  -d '{"name":"gasless-agent","owner":"0x&lt;your-eoa&gt;","signature":"0x&lt;sig&gt;"}' | jq .</code></pre>
<p>Verified live — the first production registration happened while writing this article:</p>
<pre><code class="language-json">POST /api/v1/agents/register → 201
{
  "agent_id": "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:2332",
  "registry": "erc-8004",
  "registry_tx": "0x78dd4d11ea3c6c95e78afc0f9a078da875d21b615050c07d6c3bdf909ed9d3cb",
  "tier": "observer",
  "api_key": "agb_…"   // shown once; stored as sha256 only
}
GET /api/v1/agents/me (Bearer agb_…) → 200  // key works immediately</code></pre>
<p>The mint transaction is on Arc mainnet (<a href="https://explorer.arc.io/tx/0x78dd4d11ea3c6c95e78afc0f9a078da875d21b615050c07d6c3bdf909ed9d3cb">explorer</a>): 437,174 gas, block 25270327 — a real ERC-8004 passport minted by the ops signer, paid in USDC by the treasury.</p>
<p><img src="/images/blog/arc-c20-prod-tx-2332.png" alt="Arc explorer: production registration mint tx 0x78dd4d11…, block 25270327" /></p>
<ul>
<li>Source: <code>server/lib/agent-registration/{register,intent,sponsored-gate,public-view,store}.ts</code>, route in <code>server/routes/agents-register-api.ts</code> — <a href="https://github.com/spreadzp/agentbadge">agentbadge repo</a></li>
<li>Tests: <code>tests/agent-registration-api.test.ts</code> (unit, incl. EIP-191 verify), <code>tests/e2e/agent-registration.test.ts</code> (full cycle incl. sponsored + caps)</li>
</ul>

<h2 id="whats-next">What's next</h2>
<p>Registration answers "who are you" — the next slice answers "prove it". Ownership-verification rails (per-agent codes, DB-level exclusivity on <code>(type, locator, network)</code>) are already specced as 184-7: claim a domain, X handle, or Substack publication and you prove it <em>before</em> it can route payouts. Our own domain goes through the same rail via <code>/.well-known/agentbadge-verify.txt</code> — no special-casing ourselves.</p>

<p><em>This is C20 in the Arc Campaign series. Previously: <a href="https://agentbadge.xyz/blog/arc-c27-did-web-identity">Who Are You, Agent? A DID Your Domain Can Prove</a>.</em></p>
<p><strong>Links:</strong> <a href="https://agentbadge.xyz/api/meta/trust-tiers">Trust tiers</a> · <a href="https://agentbadge.xyz/api/meta/errors">Error catalog</a> · <a href="https://agentbadge.xyz/llms.txt">llms.txt</a> · <a href="https://agentbadge.xyz/verification.md">Verification policy</a> · <a href="https://agentbadge.xyz">AgentBadge</a></p>
<p><em>Don't certify. Measure.</em></p>`,
};
