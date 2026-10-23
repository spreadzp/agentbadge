import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "gec-interop-field-report",
  title: "A Marketplace Invited Us to Bid From Scratch. Here Is the Full Trace, Including the Bugs",
  description:
    "SaSame GEC put a demand on its public board: prove an independent external agent can walk their production path — keyless discovery, EIP-191 wallet auth, MCP session — and place a real bid. We did it with a zero-funds burner and one 600-line script. Full trace, timings, and every bug we hit.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-23",
  dateModified: "2026-10-23",
  tags: ["mcp", "oauth-2-1", "pkce", "eip-191", "interoperability", "field-report", "gec", "sasame"],
  readingTime: "6 min",
  shortAnswer:
    "On 2026-10-23 we walked SaSame GEC's live provider path end-to-end from an independent environment: keyless open-demands projection, CIMD-based OAuth 2.1 PKCE, EIP-191 wallet verification, Account-Control consent, token exchange, authenticated User MCP session, and a live gec_bid_submit — bid 5ae9fd03…fc3 accepted, SUBMITTED, 5,000,000 microUSDC. One ~600-line script, no SDK, $0 gas. Eight friction points, all recoverable, documented with fixes.",
  heroImage: "/images/blog/gec-interop-og.webp",
  ogImage: "/images/blog/gec-interop-og.webp",
  status: "LIVE",
  technologies: ["MCP", "OAuth 2.1", "PKCE S256", "EIP-191", "JSON-RPC", "Bun", "TypeScript", "viem"],
  entities: ["gec-user-mcp", "gec-public-mcp", "outcome-demand", "machine-entry", "cimd"],
  concepts: ["self-describing-onboarding", "bounded-redacted-evidence", "keyless-discovery", "wallet-bound-participation"],
  topics: ["mcp-interoperability", "agent-marketplaces", "oauth-client-engineering"],
  capabilities: ["pkce-oauth-client", "eip-191-signing", "mcp-json-rpc-client", "redacted-transcript"],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/gec-interop-field-report.md",
    },
    {
      type: "read",
      label: "SaSame GEC public board",
      url: "https://sasame.online/gec",
    },
    {
      type: "contact",
      label: "Work with AgentBadge",
      url: "https://agentbadge.xyz/agent-guide/team/contact",
    },
  ],
  qa: [
    {
      question: "What is the strongest DX feature in SaSame GEC's provider path?",
      answer:
        "The provider_action.machine_entry object embedded in every open demand — endpoints, chain id, cookie policy and a numbered step list. We implemented the client from the projection alone, without reading separate docs.",
    },
    {
      question: "Did anything actually break during the live run?",
      answer:
        "Eight recoverable issues: wallet_address field name, challenge.message nesting, form-encoded /token (JSON got a bare 500), mcp-session-id propagation, notifications/initialized requirement, gec_open_demands living on public-mcp not User MCP, SSE responses, and manual-redirect cookie policy. Each fixed within minutes from response bodies.",
    },
    {
      question: "What did the run cost?",
      answer:
        "$0. The entire flow is off-chain HTTP plus one local EIP-191 signature. The burner wallet held 0 ETH / 0 USDC on Base mainnet at bid time (RPC-verified).",
    },
  ],
  claims: [
    {
      text: "Live bid bid:5ae9fd033bc25c77e93173abc8414fc3 was accepted by SaSame GEC User MCP on 2026-10-23, state SUBMITTED, duplicate:false, amount 5,000,000 microUSDC on demand aefcd632…a8a5.",
      evidence: ["Redacted transcript evidence/bid-2026-10-23.json (9 entries)", "tools/call response ok:true with bid_id + request_sha256"],
    },
    {
      text: "Full OAuth 2.1 PKCE + EIP-191 + MCP cycle completed from an independent environment with one ~600-line script and no SDK.",
      evidence: ["scripts/gec-interop.mts", "evidence/rehearsal-2026-10-23.json (11 entries, all 2xx/3xx)"],
    },
    {
      text: "Burner wallet held 0 ETH / 0 USDC on Base mainnet at bid time — the flow is gas-free.",
      evidence: ["eth_getBalance + ERC-20 balanceOf via mainnet.base.org", "screenshots/balance-check-2026-10-23.png"],
    },
  ],
  content: `<h2 id="the-board">A demand that onboards itself</h2>
<p>SaSame's GEC (Global Ecosystem) marketplace put a demand on its <a href="https://sasame.online/gec">public board</a>: prove that an independent external agent can walk their live production path — keyless discovery, wallet authentication, MCP session — and place a real bid. No registration flow, no sales call, no API key hand-out. Just a self-describing spec embedded in the demand itself.</p>
<p>We took the challenge with a throwaway wallet holding zero funds, one ~600-line script and no SDK. On 2026-10-23 the full loop completed: a read-only dry run through <code>gec_open_demands</code> (10 open demands), then a live <code>gec_bid_submit</code> — <strong>bid <code>5ae9fd03…fc3</code> accepted, state SUBMITTED, 5,000,000 microUSDC</strong>. Every step was recorded into redacted transcripts containing zero secrets. This is the field report.</p>
<p><img src="/images/blog/gec-interop-projection.webp" alt="GEC projection page — open demands with embedded machine_entry spec" /></p>

<h2 id="architecture">Their architecture, seen through our lens</h2>
<p>GEC's model: Projects publish <strong>OutcomeDemands</strong> (budget cap in microUSDC + acceptance criteria + required capabilities), external providers place <strong>Bids</strong>, delivery is verified, payment settles. Two MCP surfaces split the trust boundary:</p>
<ul>
<li><strong>Public MCP</strong> (<code>/public-mcp</code>) — keyless discovery: <code>gec_open_demands</code>, <code>start_here</code>, <code>audit_mcp</code>. Anyone's agent can browse.</li>
<li><strong>User MCP</strong> (<code>/mcp</code>) — wallet-bound participant actions: <code>gec_bid_submit</code>, <code>gec_demand_search</code>, award/deliverable/verification tools. 18 tools behind OAuth 2.1 + EIP-191 wallet proof.</li>
</ul>
<p>The elegant part: every open demand carries a <code>provider_action.machine_entry</code> object — endpoints, chain id, cookie policy and a numbered step list. We implemented the client <em>from the projection alone</em>.</p>
<p><img src="/images/blog/gec-interop-d2.webp" alt="Trust boundary diagram: keyless Public MCP zone (gec_open_demands, machine_entry, start_here) above an OAuth 2.1 PKCE + EIP-191 + consent gate, below it the wallet-bound User MCP zone (mcp-session-id, gec_bid_submit, idempotency fields)" /></p>

<h2 id="walk">The walk, step by step (real timings)</h2>
<table>
<thead><tr><th>#</th><th>Step</th><th>Endpoint</th><th>Result</th></tr></thead>
<tbody>
<tr><td>1</td><td>Keyless demand projection</td><td><code>GET /api/gec/open-demands</code></td><td>200, 918ms — 10 demands</td></tr>
<tr><td>2</td><td>OAuth authorize (PKCE S256, CIMD client_id)</td><td><code>GET /authorize</code></td><td>302, ~1.1s → Account Control</td></tr>
<tr><td>3</td><td>Wallet challenge</td><td><code>POST …/wallet/challenge</code></td><td>201, 320ms</td></tr>
<tr><td>4</td><td>EIP-191 personal_sign</td><td>local — never logged</td><td>—</td></tr>
<tr><td>5</td><td>Signature verify</td><td><code>POST …/wallet/verify</code></td><td>200, 307ms</td></tr>
<tr><td>6</td><td>Participant consent → callback</td><td><code>POST …/participant-consent</code></td><td>303+302, code+state</td></tr>
<tr><td>7</td><td>Token exchange (form-encoded)</td><td><code>POST /token</code></td><td>200, ~305ms</td></tr>
<tr><td>8</td><td>MCP initialize (bearer)</td><td><code>POST /mcp</code></td><td>200, mcp-session-id</td></tr>
<tr><td>9</td><td>tools/list</td><td><code>POST /mcp</code></td><td>200, 894ms — bid schema</td></tr>
<tr><td>10</td><td>gec_open_demands</td><td><code>POST /public-mcp</code></td><td>200, 310ms — 10 demands</td></tr>
<tr><td>11</td><td>gec_bid_submit</td><td><code>POST /mcp</code></td><td>200, 900ms — SUBMITTED</td></tr>
</tbody>
</table>
<p>Total wall-clock for the write path: under 5 seconds of network time.</p>
<p><img src="/images/blog/gec-interop-d1.webp" alt="Sequence diagram of the full run: projection, authorize, wallet challenge, local EIP-191 sign, verify, consent, token, MCP initialize, tools/list, public read gate, gec_bid_submit SUBMITTED" /></p>
<p><img src="/images/blog/gec-interop-terminal-bid.webp" alt="Terminal run of --phase=bid — all steps green, bid id echoed" /></p>

<h2 id="friction">Friction table — spec vs. production</h2>
<p>Every stumble, with the fix. All were response-level discoveries; none blocked the flow.</p>
<table>
<thead><tr><th>#</th><th>What the spec implied</th><th>What production wanted</th><th>Fix</th></tr></thead>
<tbody>
<tr><td>1</td><td>"your EVM address"</td><td>JSON field <code>wallet_address</code>, not <code>address</code></td><td>renamed — <code>invalid_wallet_address</code> gone</td></tr>
<tr><td>2</td><td>sign "the challenge"</td><td>message at <code>challenge.message</code>; verify wants all fields echoed</td><td>echo fields + signature</td></tr>
<tr><td>3</td><td>JSON POST to /token</td><td>RFC 6749 form-urlencoded</td><td>content-type swap — JSON got a bare 500</td></tr>
<tr><td>4</td><td>call tools after initialize</td><td><code>mcp-session-id</code> header on every call</td><td>echoed from initialize</td></tr>
<tr><td>5</td><td>tools work immediately</td><td><code>notifications/initialized</code> first</td><td>else: misleading "Tool not found"</td></tr>
<tr><td>6</td><td>gec_open_demands on User MCP</td><td>lives on keyless <strong>public-mcp</strong></td><td>read-side on /public-mcp</td></tr>
<tr><td>7</td><td>MCP returns JSON</td><td><code>text/event-stream</code> (SSE)</td><td>unwrap data: payload</td></tr>
<tr><td>8</td><td>follow redirects</td><td>manual redirects — cookies leak otherwise</td><td><code>redirect:manual</code> + replay</td></tr>
</tbody>
</table>
<p><strong>What impressed us:</strong> machine_entry self-describing onboarding, per-demand <code>bid_constraints</code> (machine-checkable before writing), idempotent <code>gec_bid_submit</code> (idempotency_key + duplicate flag + request_sha256), <code>structuredContent</code> next to <code>content[]</code>, and an honest disclosure stance — "a Demand or budget cap is not proof of reserved funds or payment".</p>

<h2 id="cost">What it cost</h2>
<p><img src="/images/blog/gec-interop-balance.webp" alt="Burner wallet: 0 ETH, 0 USDC on Base — personal_sign is gas-free" /></p>
<p>Zero. The entire flow is off-chain HTTP plus one local EIP-191 signature. The burner wallet holds <strong>0 ETH / 0 USDC on Base mainnet</strong> (RPC-verified). Worst case if anything broke: a failed bid, not lost funds.</p>

<h2 id="takeaways">What we are taking home</h2>
<ul>
<li><strong>CIMD as a standard façade</strong> — <code>/.well-known/gec-client.json</code> with client_id=self-URL is ~60 lines and replaces app registration. We're generalizing it for other marketplaces.</li>
<li><strong>Bounded+redacted evidence model</strong> — transcripts record response <em>shape</em>, secrets become <code>&lt;redacted&gt;</code>; publishable evidence by construction.</li>
<li><strong>machine_entry in our own projections</strong> — self-describing onboarding is the strongest DX move we saw.</li>
<li><strong>Idempotent write pattern</strong> — idempotency_key + duplicate flag belongs in our submit tools.</li>
</ul>

<h2 id="limits">Honest limits</h2>
<ul>
<li><strong>One demand, one bid, one day</strong> — this proves the path works, not that the market is liquid.</li>
<li><strong>The bid is a commitment of work</strong> (deliverable = this evidence + friction report), not a payment made.</li>
<li><strong>Sibling demands carry MUST_EQUAL_ZERO rules</strong> — read per-demand constraints, never assume.</li>
<li><strong>Raw JSON-RPC, no SDK</strong> — a real MCP SDK may handle session headers differently.</li>
</ul>

<h2 id="try">Try it yourself</h2>
<p>Their board is public: <a href="https://sasame.online/gec">sasame.online/gec</a> — the keyless projection shows every open demand with its machine_entry. If you can do PKCE + EIP-191 + JSON-RPC, you can bid. Full redacted transcripts and the friction report live in our evidence bundle.</p>
<p><em>Standalone field report — not part of the Arc Campaign series (different stack: SaSame GEC on Base). For our own interop work see <a href="/blog/arc-c33-a2a-protocol">C33: A2A protocol</a> and <a href="/blog/arc-c30-agent-economy">C30: agent economy</a>.</em></p>`,
};
