import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "usdc-rescue-base-to-arc",
  title: "$5 of USDC Was Stuck on Base With Zero ETH. We Rescued It Cross-Chain for $0.21.",
  description:
    "An agent burner wallet held 5 USDC on Base mainnet and 0 ETH — a trap: ERC-20 transfers need native gas the wallet cannot pay. Live rescue on 2026-10-24: Relay refuel (~11 s ETH delivery) then Circle CCTP burn→attestation→mint into our operator on Arc. Every txhash and every failure included.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-24",
  dateModified: "2026-10-24",
  tags: ["usdc", "cctp", "gas-refuel", "relay", "base", "arc", "cross-chain", "field-report"],
  readingTime: "5 min",
  shortAnswer:
    "On 2026-10-24 we rescued 5 USDC from a Base burner wallet with zero ETH: Relay Protocol refueled 0.0000691 ETH in ~11 s (cost 0.185 USDC — GasZip rejected us, its LiFi floor is ~0.5 USDC), then CCTP v2 burned on Base, Iris attested in ~24 min, and a permissionless receiveMessage minted 5 USDC to our operator on Arc. Total cost ~0.21 USDC (~4%), end-to-end ~26 min.",
  heroImage: "/images/blog/usdc-rescue-hero.webp",
  ogImage: "/images/blog/usdc-rescue-og.webp",
  status: "LIVE",
  technologies: ["CCTP v2", "Relay Protocol", "LI.FI GasZip", "viem", "Bun", "TypeScript"],
  entities: ["circle-cctp", "iris-attestation", "relay-bridge", "gaszip", "message-transmitter"],
  concepts: ["gas-refuel", "permissionless-mint", "attestation-finality", "stuck-erc20", "usdc-as-gas"],
  topics: ["cross-chain-recovery", "agent-wallet-ops", "arc-blockchain"],
  capabilities: ["cctp-burn-mint-flow", "bridge-quote-probing", "resume-after-timeout"],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/usdc-rescue-base-to-arc.md",
    },
    {
      type: "read",
      label: "CCTP docs (Circle)",
      url: "https://developers.circle.com/cctp",
    },
    {
      type: "contact",
      label: "Work with AgentBadge",
      url: "https://agentbadge.xyz/agent-guide/team/contact",
    },
  ],
  qa: [
    {
      question: "How do you move ERC-20 tokens from a wallet that has no native gas?",
      answer:
        "Two hops: (1) gas refuel — a bridge aggregator sends a small amount of native token to the stranded wallet, paid with stablecoins from another chain (we used Relay: 0.185 USDC on Arc → 0.0000691 ETH on Base, ~11 s); (2) the normal ERC-20 flow — CCTP depositForBurn on Base → Iris attestation → receiveMessage mint on the destination chain.",
    },
    {
      question: "Why did GasZip fail and what replaced it?",
      answer:
        "The LiFi GasZip route has a floor of roughly 0.5 USDC — every quote below ~0.45 returns 'No available quotes'. Our operator held 0.19 USDC and the RPC rejected the send (have 0.190, want 0.504). Relay Protocol's API accepted 0.185 USDC through an ERC-20 approve+deposit pair and delivered ETH in ~11 seconds.",
    },
    {
      question: "What did the rescue cost and how long did it take?",
      answer:
        "About 0.21 USDC total (~4% of the rescued 5 USDC): 0.185 refuel input, ~0.02 Relay fee, plus gas on both chains. End-to-end ~26 minutes, of which ~24 was the unskippable Circle Iris attestation finality wait.",
    },
  ],
  claims: [
    {
      text: "5 USDC was transferred from burner 0x3bF7…b89f on Base to operator 0xcdd23d…699d on Arc on 2026-10-24 via CCTP v2; burn tx 0x2c60097d…bc8c (Base), mint tx 0xe9057fd7…b8ea (Arc), both confirmed.",
    },
    {
      text: "LiFi GasZip route from Arc rejects amounts below ~0.5 USDC: quotes for 0.05–0.45 USDC all returned 'No available quotes' and the 0.5 send was RPC-rejected with 'insufficient funds: have 0.190, want 0.504'.",
    },
    {
      text: "Relay Protocol delivered 0.0000691 ETH to the burner on Base ~11 seconds after the deposit tx 0x7a01bca8…f00f5b on Arc confirmed; input 0.185 USDC, relayer fee ~0.02 USDC.",
    },
    {
      text: "CCTP attestation for the Base→Arc burn took ~24 minutes (Iris pending_confirmations → complete); the mint was paid by a different wallet than the refuel sender because receiveMessage is permissionless.",
    },
  ],
  economicContext: {
    summary:
      "Recovery of stranded ERC-20 liquidity: 5 USDC rescued at ~4% cost. Demonstrates that gas-refuel + CCTP is a viable ops pattern for agent fleets where wallets accumulate balances without native gas.",
  },
  relatedResources: [
    { title: "docs/SWAP case artifacts (SPEC, CASE-LOG, logs, shots)", url: "https://github.com/agentbadge/agentbadge/tree/main/docs/SWAP" },
    { title: "Circle CCTP reference", url: "https://developers.circle.com/cctp/references/contract-addresses" },
  ],
  content: `
<p>An agent burner wallet ended up holding <strong>5 USDC on Base mainnet and exactly 0 ETH</strong>. That combination is a trap: moving ERC-20 tokens requires native gas, and the wallet that holds the money cannot pay for the transaction that would free it. On 2026-10-24 we ran the rescue live — a ~$0.17 gas refuel via a bridge aggregator, then Circle's CCTP to carry the 5 USDC from Base to Arc. Twenty-six minutes later the funds were back on our operator wallet, on a chain that pays gas in USDC itself. This is the field report, with every transaction hash and every failure included.</p>
<p><img src="/images/blog/usdc-rescue-relay.webp" alt="Relay refuel — 0.185 USDC on Arc became 0.0000691 ETH on Base in ~11 seconds" /></p>

<h2 id="the-trap">The trap</h2>
<p>The burner <code>0x3bF7…b89f</code> is a throwaway key we use for agent experiments. It accumulated 5 USDC on Base mainnet — and held zero ETH. Every exit path needs gas: <code>USDC.approve()</code> then <code>TokenMessengerV2.depositForBurn()</code> for CCTP, or a plain <code>transfer()</code>. All of them are ERC-20 calls the burner signs — and Base charges ETH for that signature, not USDC.</p>
<p>The fix is a two-hop strategy:</p>
<ol>
<li><strong>Refuel</strong>: get a drip of ETH to the burner on Base, paid for with USDC we hold elsewhere (on Arc, where USDC <em>is</em> the gas token).</li>
<li><strong>Rescue</strong>: CCTP v2 <code>depositForBurn</code> on Base → Circle Iris attestation → <code>receiveMessage</code> mint on Arc, recipient = our operator wallet.</li>
</ol>

<h2 id="plan-a">Plan A died on a provider minimum</h2>
<p>Our first candidate was GasZip through the LI.FI aggregator — purpose-built for exactly this: send USDC on one chain, receive native gas on another. Quotes looked perfect: 0.5 USDC → 0.000211 ETH, ~2 s execution.</p>
<p><img src="/images/blog/usdc-rescue-blocked.webp" alt="GasZip rejected — have 0.190 USDC, want 0.504" /></p>
<pre><code>insufficient funds for gas * price + value:
  have 190242293492133071   (0.190 USDC)
  want 504019005393246480   (0.504 USDC)</code></pre>
<p>Probing <code>li.quest/v1/quote</code> at 0.05 / 0.1 / 0.15 / 0.2 / 0.25 / 0.3 / 0.35 / 0.4 / 0.45 USDC — every amount below ~0.5 returns <code>No available quotes</code>. Our operator held <strong>0.190242 USDC</strong> on Arc. All our Arc wallets combined held ~0.295. GasZip's floor was simply unreachable.</p>
<p><strong>Lesson one:</strong> on dust-balance source chains, a bridge's minimum size matters more than its quoted rate. Check your balance against the floor <em>before</em> picking the provider, not after the RPC rejection.</p>

<h2 id="pivot">The pivot: Relay took what GasZip wouldn't</h2>
<p>Relay Protocol (<code>api.relay.link</code>) quoted the same route — USDC on Arc → ETH on Base — starting from amounts GasZip refused. We sent <strong>0.185 USDC</strong> through its two-step flow (ERC-20 <code>approve</code> + <code>deposit</code>, since Relay uses the token interface rather than GasZip's native value):</p>
<ul>
<li>approve <code>0xf307371832133bd3c8d8d3b4679127a400ce28a64554230ca708f0abca56c601</code> (Arc)</li>
<li>deposit <code>0x7a01bca83dfb1aae5d1aab8205ce467e0b0d015f2e79e7c1b8c537ac29600f5b</code> (Arc)</li>
</ul>
<p>Eleven seconds after the deposit confirmed, the burner had <strong>0.0000691 ETH</strong> on Base — fee ~0.02 USDC. More than enough: Base gas for <code>approve</code> + <code>depositForBurn</code> costs roughly 0.00001 ETH.</p>

<p><img src="/images/blog/d1-en.webp" alt="Sequence diagram — operator, GasZip/LiFi rejection, Relay approve+deposit, burner burn on Base, Iris attestation ~24 min, permissionless receiveMessage mint on Arc" /></p>
<h2 id="cctp">CCTP: burn, wait, mint</h2>
<p>With gas in place, the standard Circle CCTP path ran:</p>
<ul>
<li><code>USDC.approve(TokenMessengerV2, 5_000_000)</code> — <code>0xb37458778f83a8c45c762f6dd09bf45e6f25aef7d2d22405be2ca6ac763d5af1</code> (Base)</li>
<li><code>depositForBurn</code> — <code>0x2c60097d665bf5234de80bb1189efe20166b108819e124f129033ceae44dbc8c</code> (Base, mined 11:00:50 UTC)</li>
</ul>
<p><img src="/images/blog/usdc-rescue-burn.webp" alt="CCTP burn submitted on Base" /></p>
<p>Then the part nobody can speed up: Circle's Iris attestation. Our script polled <code>/v2/messages/6?transactionHash=…</code> and hit its 20-minute timeout while status was still <code>pending_confirmations</code>. The burn was mined, nothing was lost — the <code>resume</code> mode re-polled and found <code>status: complete</code> at ~24 minutes. Attestation waits are a scheduling fact, not a failure mode: <strong>build resume, don't rebuild the burn</strong>.</p>
<p>One more production wrinkle: by the time attestation landed, our operator wallet had ~0.003 USDC left on Arc — spent on the Relay steps — not enough for the mint's gas. <code>receiveMessage</code> is <strong>permissionless</strong>, so a different funded wallet (<code>ARC_OPS_KEY</code>) paid the mint. The USDC still went to the <code>mintRecipient</code> encoded in the message — the caller only pays gas.</p>
<p><img src="/images/blog/usdc-rescue-mint.webp" alt="Mint confirmed — OPERATOR Arc balance 0.19 → 5.002 USDC" /></p>
<ul>
<li>mint <code>0xe9057fd74703296c76b09f28c3687e83d7005890ab59c6b55e8dcf9286bbb8ea</code> (Arc, confirmed 11:24:43 UTC)</li>
</ul>

<p><img src="/images/blog/d2-en.webp" alt="Full rescue process flowchart — stranded state, aggregator probe, Relay refuel, CCTP burn, attestation wait with resume loop, permissionless mint, final balances" /></p>
<p><em>The whole run in one picture: probe → dead plan A → Relay refuel → burn → attestation wait (with resume) → permissionless mint.</em></p>
<h2 id="ledger">The ledger</h2>
<table>
<thead><tr><th>Item</th><th>Value</th></tr></thead>
<tbody>
<tr><td>Rescued</td><td><strong>5.00 USDC</strong> (burner Base → OPERATOR Arc)</td></tr>
<tr><td>Refuel spend</td><td>0.185 USDC in, ~0.02 fee + ~0.005 gas</td></tr>
<tr><td>Delivered gas</td><td>0.0000691 ETH (~$0.17) on Base</td></tr>
<tr><td>Dust left</td><td>0.000068 ETH on burner Base</td></tr>
<tr><td>Burn→attestation</td><td>~24 min (finality threshold, unskippable)</td></tr>
<tr><td>Attestation→mint</td><td>~1 s</td></tr>
<tr><td><strong>E2E mainnet</strong></td><td><strong>~26 min, ~0.21 USDC total (~4%)</strong></td></tr>
<tr><td>Net on Arc</td><td>0.190 → 5.002 USDC</td></tr>
</tbody>
</table>

<h2 id="friction">Friction table — spec vs. production</h2>
<table>
<thead><tr><th>#</th><th>What the docs implied</th><th>What actually happened</th><th>Fix</th></tr></thead>
<tbody>
<tr><td>1</td><td>GasZip handles any dust amount</td><td>LiFi route floor ≈0.5 USDC — quotes &lt;0.45 don't exist</td><td>Relay API, accepts 0.185</td></tr>
<tr><td>2</td><td>Refuel is one tx</td><td>Relay needs ERC-20 approve + deposit (unlike GasZip's native value)</td><td>Two steps, both on Arc</td></tr>
<tr><td>3</td><td>Attestation ~15–20 min</td><td>~24 min — script timed out at 20</td><td><code>resume &lt;burnTx&gt; mainnet</code> re-polls, no re-burn</td></tr>
<tr><td>4</td><td>Flag style <code>--mainnet</code></td><td>Positional arg <code>mainnet</code>; <code>--mainnet</code> parsed as testnet flag → Iris sandbox 404</td><td>Pass bare <code>mainnet</code></td></tr>
<tr><td>5</td><td>Operator pays the mint</td><td>Operator had ~0.003 USDC left, mint needs ~0.003</td><td>Permissionless <code>receiveMessage</code> — paid by second key</td></tr>
</tbody>
</table>

<h2 id="why">Why this pattern matters</h2>
<p>Any agent fleet will eventually hold stranded ERC-20 balances — the wallet dies before its tokens do. The recovery recipe that worked here is small enough to script: probe aggregator quotes <em>with minimums in mind</em>, refuel ~$0.20 of native gas, then let CCTP do the heavy lifting while you wait for attestation. And a detail that makes Arc interesting for this exact problem: <strong>gas is paid in USDC there</strong>, so the rescued funds land on a chain where the wallet can never fall into the zero-native-token trap again.</p>
<p><img src="/images/blog/usdc-rescue-recap.webp" alt="Full recap — five transactions, one pivot, 5 USDC saved" /></p>
<p>All transactions, timings and raw logs: <code>docs/SWAP/</code> in our monorepo — SPEC, CASE-LOG, structured events, and the ten terminal screenshots used in this post. The script (<code>swap-rescue.mts</code>) is a Bun/viem CLI with <code>quote | relay | gaszip | testnet-cctp | cctp | resume</code> modes.</p>
`,
};
