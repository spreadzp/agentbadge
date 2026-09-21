// EPIC-140 (SLICE-140-19): ai-builders hero + architecture sections.
import { html, raw } from "hono/html";
import { sectionWrapper } from "./shared";

export function Hero() {
  return html`<section class="relative overflow-hidden border-b border-slate-700/50 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-indigo-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <span class="inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium text-indigo-300">
          AI Builders Hackathon
        </span>
        <div class="mt-6 inline-flex items-center gap-3 rounded-2xl border border-slate-600/50 bg-slate-800/40 px-6 py-3 backdrop-blur-sm">
          <div class="flex flex-col items-center gap-1">
            <img src="/icons/favicon-180.png" alt="AgentBadge" class="h-10 w-10 rounded-lg" />
            <span class="text-[10px] font-medium text-slate-400">AgentBadge</span>
          </div>
          <div class="flex flex-col items-center">
            <svg class="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8m0 0l-3-3m3 3l-3 3M16 17H8m0 0l3-3m-3 3l3 3" />
            </svg>
            <span class="text-[9px] text-indigo-400 font-mono">onchain</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <span class="text-2xl">⛓️</span>
            <span class="text-[10px] font-medium text-slate-400">Base Sepolia</span>
          </div>
        </div>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          Onchain Trust Records for the Agentic Web
        </h1>
        <p class="mt-6 text-lg text-slate-300 sm:text-xl">
          AgentBadge scans any site for agent-readiness, records the result onchain on Base Sepolia, and mints a soulbound trust badge. 40+ deterministic rules, MCP-native, x402 payments.
        </p>
        <div class="mt-8 flex flex-wrap justify-center gap-4">
          <a href="#demo" class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">
            Try the demo →
          </a>
          <a href="#audit" class="rounded-lg border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-400 transition">
            Live audit trail →
          </a>
          <a href="https://github.com/agentbadge/agentbadge" target="_blank" rel="noopener" class="rounded-lg border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-400 transition">
            GitHub ↗
          </a>
        </div>
        <div class="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">40+</div>
            <div class="text-xs text-slate-400">Readiness rules</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">6</div>
            <div class="text-xs text-slate-400">MCP tools</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">2</div>
            <div class="text-xs text-slate-400">Trust contracts</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">$0.01</div>
            <div class="text-xs text-slate-400">x402 per record</div>
          </div>
        </div>

        <div class="mt-8 space-y-3">
          <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
            <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
              <span class="flex items-center gap-2">
                <span class="text-purple-400">⚙️</span> Onchain Workflows (3)
              </span>
              <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
              <p>Three onchain workflows power the trust record pipeline:</p>
              <div class="space-y-3">
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-purple-300 text-xs">1. record-scan</p>
                  <p class="mt-1 text-slate-400">Triggered after each AgentBadge scan. Calls <code class="text-amber-300">TrustRegistry.recordScan()</code> on Base Sepolia with the scan result, site URL, score, and rule breakdown. Creates a permanent onchain trust record.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-purple-300 text-xs">2. mint-trust-badge</p>
                  <p class="mt-1 text-slate-400">Triggered when scan score ≥ 85. Calls <code class="text-amber-300">TrustBadge.mint()</code> to mint a soulbound ERC-721 NFT on Base Sepolia. The badge is non-transferable and permanently linked to the scanned site.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-purple-300 text-xs">3. audit-stream</p>
                  <p class="mt-1 text-slate-400">Long-running workflow that listens for <code class="text-amber-300">RecordScan</code> events on TrustRegistry and streams them via SSE to the audit trail table. No page refresh needed — rows appear live.</p>
                </div>
              </div>
            </div>
          </details>

          <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
            <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
              <span class="flex items-center gap-2">
                <span class="text-amber-400">📜</span> Trust Contracts (2)
              </span>
              <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
              <p>Two smart contracts on Base Sepolia (84532) form the onchain trust layer:</p>
              <div class="space-y-3">
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <div class="flex items-center gap-2">
                    <p class="font-mono text-amber-300 text-xs">TrustRegistry.sol</p>
                    <span class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400 border border-amber-500/20">Base Sepolia</span>
                  </div>
                  <p class="mt-1 text-slate-400">Stores scan records onchain. Key functions:</p>
                  <ul class="list-disc pl-5 mt-1 space-y-1 text-slate-400 text-xs">
                    <li><code class="text-amber-300">recordScan(siteUrl, score, rulesPassed, rulesTotal)</code> — creates a trust record</li>
                    <li><code class="text-amber-300">getRecord(id)</code> — returns scan data for verification</li>
                    <li><code class="text-amber-300">recordCount()</code> — total records onchain</li>
                  </ul>
                  <p class="mt-2 text-slate-400">Emits <code class="text-amber-300">RecordScan</code> event → consumed by audit-stream workflow.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <div class="flex items-center gap-2">
                    <p class="font-mono text-amber-300 text-xs">TrustBadge.sol</p>
                    <span class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400 border border-amber-500/20">ERC-721 SBT</span>
                  </div>
                  <p class="mt-1 text-slate-400">Soulbound (non-transferable) NFT contract. Key functions:</p>
                  <ul class="list-disc pl-5 mt-1 space-y-1 text-slate-400 text-xs">
                    <li><code class="text-amber-300">mint(to, siteUrl, score)</code> — mints badge (score ≥ 85 only)</li>
                    <li><code class="text-amber-300">tokenURI(tokenId)</code> — onchain metadata JSON</li>
                    <li><code class="text-amber-300">_update()</code> — override: revert on transfer (soulbound)</li>
                  </ul>
                  <p class="mt-2 text-slate-400">Implements ERC-721 with <code class="text-amber-300">_update</code> override to prevent transfers.</p>
                </div>
              </div>
              <div class="mt-3 rounded-md bg-slate-900/50 p-3 border border-indigo-500/20">
                <p class="text-xs font-semibold text-indigo-300">Contract interaction flow:</p>
                <pre class="mt-2 text-[11px] text-slate-400 font-mono leading-relaxed">AgentBadge Scan
    ↓ (score + rules)
Onchain Workflow: record-scan
    ↓
TrustRegistry.recordScan()  ──→  emits RecordScan event
    ↓                                    ↓
TrustBadge.mint() (if score ≥ 85)    audit-stream → SSE → browser</pre>
              </div>
            </div>
          </details>

          <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
            <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
              <span class="flex items-center gap-2">
                <span class="text-cyan-400">🔧</span> MCP Tools (6)
              </span>
              <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
              <p>Six MCP tools expose the full AgentBadge system to AI agents:</p>
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">scan</p>
                  <p class="mt-1 text-slate-400 text-xs">Triggers an AgentBadge scan on a given URL. Returns scan ID, score, and rule breakdown. Supports dry-run mode (no onchain tx).</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">badge</p>
                  <p class="mt-1 text-slate-400 text-xs">Checks if a site has a TrustBadge NFT. Returns token ID, mint tx, and onchain metadata if badge exists.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">passport</p>
                  <p class="mt-1 text-slate-400 text-xs">Returns the full agent-readiness passport for a site — all scan results, badges, and trust records in one call.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">verify</p>
                  <p class="mt-1 text-slate-400 text-xs">Verifies an onchain trust record by tx hash. Returns the scan data stored onchain for independent verification.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">score</p>
                  <p class="mt-1 text-slate-400 text-xs">Returns the agent-readiness score for a site. Fast lookup without running a full scan.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">search</p>
                  <p class="mt-1 text-slate-400 text-xs">Search across all scanned sites. Filter by score, grade, or readiness criteria.</p>
                </div>
              </div>
              <div class="mt-2 rounded-md bg-slate-900/50 p-3 border border-emerald-500/20">
                <p class="text-xs text-slate-400">Agents discover these tools via the MCP server descriptor at <code class="text-emerald-300">/.well-known/mcp.json</code> and call them directly — no UI needed.</p>
              </div>
            </div>
          </details>

          <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
            <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
              <span class="flex items-center gap-2">
                <span class="text-emerald-400">💵</span> x402 Payment ($0.01/record)
              </span>
              <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
              <p>Agents pay for onchain records via the x402 protocol — native HTTP 402 payment:</p>
              <ol class="list-decimal pl-5 space-y-2 text-slate-400">
                <li>Agent calls the <code class="text-emerald-300">scan</code> MCP tool with premium flag</li>
                <li>Server returns <strong class="text-amber-300">402 Payment Required</strong> with x402 challenge</li>
                <li>Agentic Wallet skill signs an <strong class="text-amber-300">EIP-3009</strong> USDC authorization</li>
                <li>Server settles payment and records the scan onchain</li>
                <li>Two onchain receipts: <strong class="text-emerald-300">USDC transfer</strong> + <strong class="text-emerald-300">TrustRegistry record</strong></li>
              </ol>
              <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                <p class="text-xs font-mono text-slate-400">Cost breakdown: $0.01 USDC per record (gas on Base Sepolia is negligible)</p>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  </section>`;
}

export function ArchitectureDiagram() {
  const svgStyle = raw('<style>\n      @keyframes dash-flow { to { stroke-dashoffset: -20; } }\n      .flow-line { stroke-dasharray: 6 4; animation: dash-flow 1s linear infinite; }\n      .flow-line-branch { stroke-dasharray: 6 4; animation: dash-flow 1.5s linear infinite; }\n      .node-rect { fill: rgb(30 41 59 / 0.7); stroke-width: 1.5; rx: 10; }\n      .node-label { fill: rgb(255 255 255); font-size: 13px; font-weight: 700; text-anchor: middle; }\n      .node-desc { fill: rgb(125 211 252); font-size: 10px; text-anchor: middle; }\n      .node-tag { fill: rgb(196 181 253); font-size: 9px; font-family: monospace; text-anchor: middle; }\n      .arrow-label { fill: rgb(252 211 77); font-size: 10px; font-weight: 600; text-anchor: middle; }\n    </style>');

  return sectionWrapper("architecture", "", html`
    <h2 class="text-2xl font-bold text-white">Architecture</h2>
    <p class="mt-2 text-slate-100">Every arrow is one verifiable transaction on Base Sepolia (84532).</p>

    <div class="mt-8 overflow-x-auto">
      <svg viewBox="0 0 900 360" class="mx-auto w-full max-w-4xl" xmlns="http://www.w3.org/2000/svg">
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
        <rect x="195" y="25" width="390" height="340" rx="12"
              fill="rgb(99 102 241 / 0.05)" stroke="rgb(99 102 241)" stroke-width="1.5"
              stroke-dasharray="8 4" opacity="0.7" />
        <rect x="200" y="16" width="120" height="20" rx="4"
              fill="rgb(15 23 42)" stroke="rgb(99 102 241)" stroke-width="1" />
        <text x="260" y="30" fill="rgb(199 210 254)" font-size="10" font-weight="700" text-anchor="middle">⚡ AgentBadge</text>

        <rect class="node-rect" x="10" y="40" width="140" height="60" stroke="rgb(99 102 241)" />
        <text class="node-label" x="80" y="62">Site URL</text>
        <text class="node-desc" x="80" y="78">https://example.com</text>
        <text class="node-tag" x="80" y="92">web2</text>

        <line class="flow-line" x1="155" y1="70" x2="195" y2="70" stroke="rgb(99 102 241)" stroke-width="2" marker-end="url(#arrow-indigo)" />
        <text class="arrow-label" x="175" y="62">1. scan</text>

        <rect class="node-rect" x="200" y="40" width="160" height="60" stroke="rgb(34 197 94)" />
        <text class="node-label" x="280" y="62">AgentBadge Scan</text>
        <text class="node-desc" x="280" y="78">40 rules, score 0-100</text>
        <text class="node-tag" x="280" y="92">web2</text>

        <line class="flow-line" x1="365" y1="70" x2="405" y2="70" stroke="rgb(34 197 94)" stroke-width="2" marker-end="url(#arrow-emerald)" />
        <text class="arrow-label" x="385" y="62">2. trigger</text>

        <rect class="node-rect" x="410" y="40" width="160" height="60" stroke="rgb(168 85 247)" />
        <text class="node-label" x="490" y="62">Onchain Workflow</text>
        <text class="node-desc" x="490" y="78">write-contract, MCP</text>
        <text class="node-tag" x="490" y="92">MCP</text>

        <line class="flow-line" x1="575" y1="70" x2="615" y2="70" stroke="rgb(168 85 247)" stroke-width="2" marker-end="url(#arrow-purple)" />
        <text class="arrow-label" x="595" y="62">3. record</text>

        <rect class="node-rect" x="620" y="40" width="160" height="60" stroke="rgb(245 158 11)" />
        <text class="node-label" x="700" y="62">TrustRegistry</text>
        <text class="node-desc" x="700" y="78">recordScan() on Base</text>
        <text class="node-tag" x="700" y="92">EVM</text>

        <line class="flow-line" x1="700" y1="105" x2="700" y2="155" stroke="rgb(245 158 11)" stroke-width="2" marker-end="url(#arrow-amber)" />
        <text class="arrow-label" x="730" y="135">4. stream</text>

        <rect class="node-rect" x="620" y="160" width="160" height="60" stroke="rgb(6 182 212)" />
        <text class="node-label" x="700" y="182">Audit Trail + SSE</text>
        <text class="node-desc" x="700" y="198">live feed + Basescan</text>
        <text class="node-tag" x="700" y="212">SSE</text>

        <path class="flow-line-branch" d="M 280 105 L 280 250 L 490 250 L 490 290" fill="none" stroke="rgb(99 102 241)" stroke-width="2" marker-end="url(#arrow-indigo)" />
        <text class="arrow-label" x="300" y="170">5. score >= 85 → mint</text>

        <rect class="node-rect" x="410" y="295" width="160" height="55" stroke="rgb(99 102 241)" />
        <text class="node-label" x="490" y="317">TrustBadge mint</text>
        <text class="node-desc" x="490" y="333">soulbound ERC-721 SBT</text>
        <text class="node-tag" x="490" y="345">ERC-721</text>
      </svg>
    </div>

    <p class="mt-6 text-center text-xs text-slate-400">Base Sepolia testnet — every arrow is one verifiable tx</p>

    <div class="mt-8 space-y-3">
      <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
          <span class="flex items-center gap-2">
            <span class="text-indigo-400">⚡</span> AgentBadge components in this flow
          </span>
          <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
          <p>The <strong class="text-indigo-300">AgentBadge Scan</strong>, <strong class="text-cyan-300">Audit Trail + SSE</strong>, and <strong class="text-indigo-300">TrustBadge mint</strong> nodes (dashed border in the diagram) are AgentBadge components:</p>
          <ul class="list-disc pl-5 space-y-2 text-slate-400">
            <li><strong class="text-emerald-300">AgentBadge Scan</strong> — runs a 40-rule agent-readiness scan, produces a score (0-100) and structured report</li>
            <li><strong class="text-cyan-300">Audit Trail + SSE</strong> — live server-sent events feed streaming onchain records to the browser in real-time</li>
            <li><strong class="text-indigo-300">TrustBadge mint</strong> — when score ≥ 85, mints a soulbound ERC-721 trust badge on Base Sepolia</li>
            <li><strong class="text-purple-300">Onchain Workflow</strong> and <strong class="text-amber-300">TrustRegistry</strong> are the onchain execution layer</li>
          </ul>
        </div>
      </details>

      <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
          <span class="flex items-center gap-2">
            <span class="text-cyan-400">📋</span> Step-by-step data flow
          </span>
          <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
          <ol class="list-decimal pl-5 space-y-2 text-slate-400">
            <li><strong class="text-indigo-300">Scan</strong> — AgentBadge scans the site URL with 40 agent-readiness rules, producing a score and structured report</li>
            <li><strong class="text-emerald-300">Trigger</strong> — Scan result triggers an onchain workflow via webhook (write-contract MCP tool)</li>
            <li><strong class="text-purple-300">Record</strong> — Workflow calls TrustRegistry.recordScan() on Base Sepolia, creating an onchain trust record</li>
            <li><strong class="text-amber-300">Stream</strong> — The onchain record streams live via SSE to the audit trail table (no page refresh needed)</li>
            <li><strong class="text-indigo-300">Mint</strong> — If the scan score ≥ 85, a soulbound TrustBadge (ERC-721 SBT) is minted on Base Sepolia</li>
          </ol>
        </div>
      </details>

      <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
          <span class="flex items-center gap-2">
            <span class="text-emerald-400">❓</span> FAQ
          </span>
          <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-4">
          <div>
            <p class="font-medium text-slate-200">What is AgentBadge?</p>
            <p class="mt-1 text-slate-400">AgentBadge is an agent-readiness scanner with 40+ deterministic rules. It checks any website for MCP compatibility, structured data, AI policies, and more — then records the result onchain as a permanent trust record.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">What is a dry-run?</p>
            <p class="mt-1 text-slate-400">A dry-run preview shows exactly what would be executed onchain (function arguments, workflow name, target contract) without actually sending a transaction. You confirm before anything goes onchain.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">What is the TrustBadge?</p>
            <p class="mt-1 text-slate-400">A soulbound (non-transferable) ERC-721 NFT minted on Base Sepolia when a site scores ≥ 85 on the agent-readiness scan. It serves as a permanent onchain proof of agent-readiness.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">How do agents pay?</p>
            <p class="mt-1 text-slate-400">Agents pay via x402 protocol — a 402 challenge triggers the Agentic Wallet skill to sign an EIP-3009 USDC transfer. Two onchain receipts: payment settlement + trust record.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">What is MCP?</p>
            <p class="mt-1 text-slate-400">Model Context Protocol — an open standard for AI agents to discover and call tools. AgentBadge exposes 6 MCP tools (scan, badge, passport, verify, score, search) that any MCP-compatible agent can call directly.</p>
          </div>
        </div>
      </details>
    </div>
  `);
}
