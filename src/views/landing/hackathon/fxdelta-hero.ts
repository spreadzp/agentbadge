// EPIC-191 (SLICE-191-19): fxdelta hero + architecture sections (keeperhub pattern).
import { html, raw } from "hono/html";
import { sectionWrapper } from "./shared";

const SETTLE_TX =
  "0x7f292710b92b0684b272872d9829899c3a5dcf83819df98908b1bd391355b6b2";
const BLOCKSCOUT_TX = `https://celo.blockscout.com/tx/${SETTLE_TX}`;

export function Hero() {
  return html`<section class="relative overflow-hidden border-b border-slate-700/50 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-indigo-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <span class="inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium text-indigo-300">
          Agents on Open Rails · Celo Mainnet · x402 · USDC
        </span>
        <div class="mt-6 inline-flex items-center gap-4 rounded-2xl border border-slate-600/50 bg-slate-800/40 px-6 py-3 backdrop-blur-sm">
          <div class="flex flex-col items-center gap-1">
            <img src="/images/hackathons/fxdelta/agentBadge.png" alt="AgentBadge" class="h-10 w-10 rounded-lg" />
            <span class="text-[10px] font-medium text-slate-400">AgentBadge</span>
          </div>
          <div class="flex flex-col items-center">
            <svg class="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8m0 0l-3-3m3 3l-3 3M16 17H8m0 0l3-3m-3 3l3 3" />
            </svg>
            <span class="text-[9px] text-indigo-400 font-mono">pays</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <img src="/images/hackathons/fxdelta/celo_logo.svg?v=3" alt="Celo" class="h-9 w-auto" />
            <span class="text-[10px] font-medium text-slate-400">Celo mainnet</span>
          </div>
        </div>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          FX Delta Agent
        </h1>
        <p class="mt-6 text-lg text-slate-300 sm:text-xl">
          A paid x402 API for AI agents. It compares live stablecoin prices on Celo with official FX rates and returns a clear signal per corridor: buy, sell, or watch. Every call is a real USDC payment on Celo mainnet.
        </p>
        <div class="mt-8 flex flex-wrap justify-center gap-4">
          <a href="#demo" class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">
            Try the API →
          </a>
          <a href="${BLOCKSCOUT_TX}" target="_blank" rel="noopener" class="rounded-lg border border-emerald-600/60 px-6 py-3 text-sm font-semibold text-emerald-300 hover:border-emerald-400 transition">
            Mainnet payment proof ↗
          </a>
          <a href="https://github.com/agentbadge/agentbadge" target="_blank" rel="noopener" class="rounded-lg border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-400 transition">
            GitHub ↗
          </a>
        </div>
        <div class="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">22</div>
            <div class="text-xs text-slate-400">currency corridors</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">$0.005</div>
            <div class="text-xs text-slate-400">USDC per paid call</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">42220</div>
            <div class="text-xs text-slate-400">Celo mainnet chain ID</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">ERC-8021</div>
            <div class="text-xs text-slate-400">tag in every settle tx</div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function ArchitectureDiagram() {
  const svgStyle = raw('<style>\n      @keyframes dash-flow { to { stroke-dashoffset: -20; } }\n      .flow-line { stroke-dasharray: 6 4; animation: dash-flow 1s linear infinite; }\n      .flow-line-branch { stroke-dasharray: 6 4; animation: dash-flow 1.5s linear infinite; }\n      .node-rect { fill: rgb(30 41 59 / 0.7); stroke-width: 1.5; rx: 10; }\n      .node-label { fill: rgb(255 255 255); font-size: 13px; font-weight: 700; text-anchor: middle; }\n      .node-desc { fill: rgb(125 211 252); font-size: 10px; text-anchor: middle; }\n      .node-tag { fill: rgb(196 181 253); font-size: 9px; font-family: monospace; text-anchor: middle; }\n      .arrow-label { fill: rgb(252 211 77); font-size: 10px; font-weight: 600; text-anchor: middle; }\n    </style>');

  return sectionWrapper("architecture", "", html`
    <h2 class="text-2xl font-bold text-white">Architecture</h2>
    <p class="mt-2 text-slate-100">One paid call, end to end. The settle leg is a real transaction on Celo mainnet (42220).</p>

    <div class="mt-8 overflow-x-auto">
      <svg viewBox="0 0 900 400" class="mx-auto w-full max-w-4xl" xmlns="http://www.w3.org/2000/svg">
        ${svgStyle}

        <defs>
          <marker id="arrow-indigo" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgb(99 102 241)" />
          </marker>
          <marker id="arrow-emerald" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgb(34 197 94)" />
          </marker>
          <marker id="arrow-purple" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgb(168 85 247)" />
          </marker>
          <marker id="arrow-amber" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgb(245 158 11)" />
          </marker>
        </defs>

        <!-- AgentBadge group container (dashed border highlights our components) -->
        <rect x="195" y="20" width="390" height="370" rx="12"
              fill="rgb(99 102 241 / 0.05)" stroke="rgb(99 102 241)" stroke-width="1.5"
              stroke-dasharray="8 4" opacity="0.7" />
        <rect x="200" y="11" width="120" height="20" rx="4"
              fill="rgb(15 23 42)" stroke="rgb(99 102 241)" stroke-width="1" />
        <text x="260" y="25" fill="rgb(199 210 254)" font-size="10" font-weight="700" text-anchor="middle">⚡ AgentBadge</text>

        <!-- Row 1: payment rail -->
        <rect class="node-rect" x="10" y="40" width="140" height="60" stroke="rgb(99 102 241)" />
        <text class="node-label" x="80" y="62">AI Agent</text>
        <text class="node-desc" x="80" y="78">wallet 0x4a2f…6bb0</text>
        <text class="node-tag" x="80" y="92">client</text>

        <line class="flow-line" x1="155" y1="70" x2="195" y2="70" stroke="rgb(99 102 241)" stroke-width="2" marker-end="url(#arrow-indigo)" />
        <text class="arrow-label" x="175" y="58">1. GET</text>
        <text class="arrow-label" x="175" y="94" fill="rgb(148 163 184)">402→sign</text>

        <rect class="node-rect" x="200" y="40" width="160" height="60" stroke="rgb(34 197 94)" />
        <text class="node-label" x="280" y="62">/api/fx-delta</text>
        <text class="node-desc" x="280" y="78">402 + accepts[]</text>
        <text class="node-tag" x="280" y="92">x402 gate</text>

        <line class="flow-line" x1="365" y1="70" x2="405" y2="70" stroke="rgb(34 197 94)" stroke-width="2" marker-end="url(#arrow-emerald)" />
        <text class="arrow-label" x="385" y="62">2. pay</text>

        <rect class="node-rect" x="410" y="40" width="160" height="60" stroke="rgb(168 85 247)" />
        <text class="node-label" x="490" y="62">Verify + Settle</text>
        <text class="node-desc" x="490" y="78">EIP-3009 permit check</text>
        <text class="node-tag" x="490" y="92">premium-gate</text>

        <line class="flow-line" x1="575" y1="70" x2="615" y2="70" stroke="rgb(168 85 247)" stroke-width="2" marker-end="url(#arrow-purple)" />
        <text class="arrow-label" x="595" y="58">3. send tx</text>
        <text class="arrow-label" x="595" y="94" fill="rgb(196 181 253)">+tag</text>

        <rect class="node-rect" x="620" y="40" width="170" height="60" stroke="rgb(245 158 11)" />
        <text class="node-label" x="705" y="62">USDC Contract</text>
        <text class="node-desc" x="705" y="78">transferWithAuthorization</text>
        <text class="node-tag" x="705" y="92">Celo 42220</text>

        <line class="flow-line" x1="705" y1="105" x2="705" y2="135" stroke="rgb(245 158 11)" stroke-width="2" marker-end="url(#arrow-amber)" />
        <text class="arrow-label" x="738" y="125">4. receipt</text>

        <rect class="node-rect" x="620" y="140" width="170" height="55" stroke="rgb(34 197 94)" />
        <text class="node-label" x="705" y="162">Settlement</text>
        <text class="node-desc" x="705" y="178">0.005 USDC moved</text>
        <text class="node-tag" x="705" y="190">ERC-8021</text>

        <path class="flow-line-branch" d="M 615 167 L 240 167 L 240 105" fill="none" stroke="rgb(34 197 94)" stroke-width="2" marker-end="url(#arrow-emerald)" />
        <text class="arrow-label" x="430" y="160">5. 200 OK + signals JSON</text>

        <!-- Row 2: data engine -->
        <rect class="node-rect" x="10" y="225" width="140" height="60" stroke="rgb(6 182 212)" />
        <text class="node-label" x="80" y="247">Celo Pools</text>
        <text class="node-desc" x="80" y="263">Mento · Uniswap</text>
        <text class="node-tag" x="80" y="277">onchain</text>

        <line class="flow-line" x1="155" y1="255" x2="195" y2="255" stroke="rgb(6 182 212)" stroke-width="2" marker-end="url(#arrow-indigo)" />
        <text class="arrow-label" x="175" y="247">reads</text>

        <rect class="node-rect" x="10" y="315" width="140" height="60" stroke="rgb(6 182 212)" />
        <text class="node-label" x="80" y="337">FX Reference</text>
        <text class="node-desc" x="80" y="353">er-api · Frankfurter · PTAX</text>
        <text class="node-tag" x="80" y="367">offchain</text>

        <path class="flow-line-branch" d="M 155 345 L 175 345 L 175 290 L 195 290" fill="none" stroke="rgb(6 182 212)" stroke-width="2" marker-end="url(#arrow-indigo)" />
        <text class="arrow-label" x="175" y="305">rates</text>

        <rect class="node-rect" x="200" y="225" width="160" height="95" stroke="rgb(34 197 94)" />
        <text class="node-label" x="280" y="255">Delta Engine</text>
        <text class="node-desc" x="280" y="271">onchain vs official FX</text>
        <text class="node-desc" x="280" y="286">22 corridors · signals</text>
        <text class="node-tag" x="280" y="305">in-memory feed</text>

        <line class="flow-line" x1="280" y1="220" x2="280" y2="105" stroke="rgb(34 197 94)" stroke-width="2" marker-end="url(#arrow-emerald)" />
        <text class="arrow-label" x="318" y="180">6. snapshot</text>

        <line class="flow-line" x1="365" y1="262" x2="405" y2="262" stroke="rgb(168 85 247)" stroke-width="2" marker-end="url(#arrow-purple)" />
        <text class="arrow-label" x="385" y="254">tools</text>

        <rect class="node-rect" x="410" y="225" width="160" height="60" stroke="rgb(168 85 247)" />
        <text class="node-label" x="490" y="247">MCP /mcp/fxdelta</text>
        <text class="node-desc" x="490" y="263">5 tools for agents</text>
        <text class="node-tag" x="490" y="277">MCP</text>

        <!-- Alerts branch -->
        <path class="flow-line-branch" d="M 365 300 L 600 300 L 600 265 L 615 265" fill="none" stroke="rgb(245 158 11)" stroke-width="2" marker-end="url(#arrow-amber)" />
        <text class="arrow-label" x="490" y="292">delta ≥ threshold → alert</text>

        <rect class="node-rect" x="620" y="230" width="170" height="55" stroke="rgb(245 158 11)" />
        <text class="node-label" x="705" y="252">Telegram Alerts</text>
        <text class="node-desc" x="705" y="268">big-gap notifications</text>
        <text class="node-tag" x="705" y="280">external</text>
      </svg>
    </div>

    <p class="mt-6 text-center text-xs text-slate-400">
      Celo mainnet (42220) — the settle leg is a real tagged transaction:
      <a href="${BLOCKSCOUT_TX}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono">0x7f2927…55b6b2 ↗</a>
    </p>

    <div class="mt-8 space-y-3">
      <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
          <span class="flex items-center gap-2">
            <span class="text-indigo-400">⚡</span> AgentBadge components in this flow
          </span>
          <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
          <p>Everything inside the dashed border runs on the AgentBadge deployment at <code class="text-amber-300">agentbadge.xyz</code>:</p>
          <ul class="list-disc pl-5 space-y-2 text-slate-400">
            <li><strong class="text-emerald-300">/api/fx-delta</strong> — HTTP API: health, corridors, snapshot, premium, stream, per-corridor, verify</li>
            <li><strong class="text-purple-300">Verify + Settle</strong> — premium gate: checks the EIP-3009 payment permit, claims the nonce, submits the onchain settle and pays gas as the seller</li>
            <li><strong class="text-emerald-300">Delta Engine</strong> — polls Celo pools (Mento FPMM + Uniswap) and official FX references every few seconds, computes deltas and signals</li>
            <li><strong class="text-purple-300">MCP /mcp/fxdelta</strong> — five MCP tools: get_delta, list_corridors, get_quote, get_events, get_digest</li>
            <li><strong class="text-amber-300">USDC Contract</strong> and <strong class="text-amber-300">Telegram</strong> are external Celo/third-party components</li>
          </ul>
        </div>
      </details>

      <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
          <span class="flex items-center gap-2">
            <span class="text-cyan-400">📋</span> Step-by-step payment + data flow
          </span>
          <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
          <ol class="list-decimal pl-5 space-y-2 text-slate-400">
            <li><strong class="text-indigo-300">Request</strong> — the agent calls <code class="text-amber-300">GET /api/fx-delta/premium</code> and gets HTTP 402 with <code class="text-amber-300">accepts</code> (USDC and USDT on eip155:42220, amount, payTo)</li>
            <li><strong class="text-emerald-300">Pay</strong> — the agent signs an EIP-3009 <code class="text-amber-300">transferWithAuthorization</code> permit (no gas spent by the buyer) and retries with the <code class="text-amber-300">PAYMENT-SIGNATURE</code> header</li>
            <li><strong class="text-purple-300">Settle</strong> — the premium gate verifies the signature, claims the nonce, and the seller submits the tx to the USDC contract with an ERC-8021 attribution tag (<code class="text-amber-300">celo_24acc530146f</code>) in calldata</li>
            <li><strong class="text-amber-300">Receipt</strong> — the server waits for the onchain receipt; the payment is auditable on Blockscout</li>
            <li><strong class="text-emerald-300">Response</strong> — only after settlement the API returns 200 with deltas and buy/sell/watch signals per corridor</li>
            <li><strong class="text-cyan-300">Engine</strong> — meanwhile the delta engine continuously reads pool reserves and official FX rates; a delta ≥ threshold pushes a Telegram alert</li>
          </ol>
        </div>
      </details>

      <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
          <span class="flex items-center gap-2">
            <span class="text-emerald-400">❓</span> FAQ — questions &amp; answers
          </span>
          <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-4">
          <div>
            <p class="font-medium text-slate-200">What does an agent actually buy?</p>
            <p class="mt-1 text-slate-400">A snapshot of the onchain premium: for every corridor (USDm, EURm, BRLm, wARS, cNGN, IDRX…) the API reports the gap between the live Celo pool price and the official FX reference, plus a signal — buy, sell, or watch. Deltas ≥ 0.5% are executable signals; thin, stale, frozen, or weekend-closed markets are flagged.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">How much does a call cost and who pays gas?</p>
            <p class="mt-1 text-slate-400">0.005 USDC per premium call on Celo mainnet (eip155:42220), payable in USDC or USDT. The buyer only signs an EIP-3009 permit — it spends no gas. The seller pays the CELO gas when it submits the settle transaction.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">Where is the proof it works on mainnet?</p>
            <p class="mt-1 text-slate-400">Every settle transaction lands on Celo mainnet and carries the ERC-8021 tag in its calldata. See the verified settle tx <a href="${BLOCKSCOUT_TX}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono">0x7f2927…55b6b2</a> — buyer <code class="text-amber-300">0x4a2f…6bb0</code> → seller <code class="text-amber-300">0x0F71…186e</code>, 0.005 USDC, block 80576414.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">Is there a free way to evaluate it?</p>
            <p class="mt-1 text-slate-400">Yes. Health, corridors and snapshot endpoints are free, and every identity (X-Wallet header or IP) gets one premium-grade call per minute on the free tier before 402 kicks in.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">How do agents consume it besides HTTP?</p>
            <p class="mt-1 text-slate-400">Via MCP: the <code class="text-amber-300">/mcp/fxdelta</code> namespace exposes get_delta, list_corridors, get_quote, get_events and get_digest, with the same freemium + x402 payment model and SSE streaming.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">What is verified onchain vs offchain?</p>
            <p class="mt-1 text-slate-400">Payments are settled and auditable on Celo mainnet. Delta verdicts can additionally be anchored to an Arc event log (hash of the canonical verdict); anchoring is disabled on production and the verify endpoint returns 404 until a record exists.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">Why does the seller hold CELO?</p>
            <p class="mt-1 text-slate-400">Self-settle means our seller wallet submits <code class="text-amber-300">transferWithAuthorization</code> itself — that is what makes every payment a tagged tx attributable to us on the ERC-8021 leaderboard. CELO covers gas (~0.02 CELO per settle).</p>
          </div>
        </div>
      </details>
    </div>
  `);
}
