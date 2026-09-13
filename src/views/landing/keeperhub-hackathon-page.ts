import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * KeeperHubHackathonPage — full landing page for the KeeperHub Agent Economy hackathon.
 *
 * Phase E (SLICE-126-15): hero, architecture diagram, how-it-works, demo form,
 * audit anchor, stack chips, API table, footer CTA.
 *
 * Demo form (126-14) is preserved as DemoSection — its markup is unchanged.
 * Audit section (id="audit") is an anchor for 126-16 (SSE audit table).
 */
export interface KeeperHubPageOpts {
  registryAddress?: string;
  badgeAddress?: string;
}

export function KeeperHubHackathonPage(opts?: KeeperHubPageOpts) {
  return html`${Hero()}
    ${ArchitectureDiagram()}
    ${HowItWorks()}
    ${DemoSection()}
    ${AuditSectionAnchor()}
    ${StackSection()}
    ${ApiSection(opts)}
    ${FooterCta()}`;
}

function sectionWrapper(id: string, extraClass: string, content: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<section id="${id}" class="border-y border-slate-700/50 bg-slate-900/30 ${extraClass}">
    <div class="mx-auto max-w-6xl px-6 py-16 sm:px-8 lg:px-12">
      ${content}
    </div>
  </section>`;
}

function Hero() {
  return html`<section class="relative overflow-hidden border-b border-slate-700/50 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-indigo-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <span class="inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium text-indigo-300">
          DoraHacks BUIDL · KeeperHub Main Track
        </span>
        <div class="mt-6 inline-flex items-center gap-4 rounded-2xl border border-slate-600/50 bg-slate-800/40 px-6 py-3 backdrop-blur-sm">
          <div class="flex flex-col items-center gap-1">
            <img src="/icons/favicon-180.png" alt="AgentBadge" class="h-10 w-10 rounded-lg" />
            <span class="text-[10px] font-medium text-slate-400">AgentBadge</span>
          </div>
          <div class="flex flex-col items-center">
            <svg class="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8m0 0l-3-3m3 3l-3 3M16 17H8m0 0l3-3m-3 3l3 3" />
            </svg>
            <span class="text-[9px] text-indigo-400 font-mono">integrates</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <img src="/images/hackathons/keeperhub-logo.svg" alt="KeeperHub" class="h-10 w-auto" />
            <span class="text-[10px] font-medium text-slate-400">KeeperHub</span>
          </div>
        </div>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          Onchain Trust Records for the Agentic Web
        </h1>
        <p class="mt-6 text-lg text-slate-300 sm:text-xl">
          AgentBadge scans any site for agent-readiness, records the result onchain through a KeeperHub workflow (Base Sepolia), and mints a soulbound trust badge. KeeperHub Agent Economy hackathon (Sep 6-18, 2026).
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
            <div class="text-2xl font-bold text-white">3</div>
            <div class="text-xs text-slate-400">KeeperHub workflows</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">2</div>
            <div class="text-xs text-slate-400">Trust contracts</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">4</div>
            <div class="text-xs text-slate-400">MCP tools</div>
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
                <span class="text-purple-400">⚙️</span> KeeperHub Workflows (3)
              </span>
              <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
              <p>Three KeeperHub workflows power the onchain trust record pipeline:</p>
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
KeeperHub Workflow: record-scan
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
                <span class="text-cyan-400">🔧</span> MCP Tools (4)
              </span>
              <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
              <p>Four MCP tools expose the trust record system to AI agents:</p>
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">keeperhub-scan</p>
                  <p class="mt-1 text-slate-400 text-xs">Triggers an AgentBadge scan on a given URL. Returns scan ID, score, and rule breakdown. Supports dry-run mode (no onchain tx).</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">keeperhub-record</p>
                  <p class="mt-1 text-slate-400 text-xs">Records a scan result onchain via KeeperHub workflow. Calls TrustRegistry.recordScan(). Returns tx hash + Basescan link.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">keeperhub-audit</p>
                  <p class="mt-1 text-slate-400 text-xs">Queries the onchain audit trail. Returns recent trust records with tx hashes, timestamps, and scan scores.</p>
                </div>
                <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                  <p class="font-mono text-cyan-300 text-xs">keeperhub-badge</p>
                  <p class="mt-1 text-slate-400 text-xs">Checks if a site has a TrustBadge NFT. Returns token ID, mint tx, and onchain metadata if badge exists.</p>
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
                <li>Agent calls <code class="text-emerald-300">keeperhub-record</code> MCP tool</li>
                <li>Server returns <strong class="text-amber-300">402 Payment Required</strong> with x402 challenge</li>
                <li>Agentic Wallet skill signs an <strong class="text-amber-300">EIP-3009</strong> USDC authorization</li>
                <li>Server settles payment and executes the KeeperHub workflow</li>
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

function ArchitectureDiagram() {
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
        <text class="node-label" x="490" y="62">KeeperHub Workflow</text>
        <text class="node-desc" x="490" y="78">webhook, write-contract</text>
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
            <li><strong class="text-purple-300">KeeperHub Workflow</strong> and <strong class="text-amber-300">TrustRegistry</strong> are KeeperHub infrastructure components</li>
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
            <li><strong class="text-emerald-300">Trigger</strong> — Scan result triggers a KeeperHub workflow via webhook (write-contract MCP tool)</li>
            <li><strong class="text-purple-300">Record</strong> — KeeperHub workflow calls TrustRegistry.recordScan() on Base Sepolia, creating an onchain trust record</li>
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
            <p class="font-medium text-slate-200">What is KeeperHub?</p>
            <p class="mt-1 text-slate-400">KeeperHub is an onchain workflow automation platform that lets smart contracts trigger external actions via MCP tools — webhooks, contract writes, and API calls.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">How does AgentBadge use KeeperHub?</p>
            <p class="mt-1 text-slate-400">AgentBadge triggers a KeeperHub workflow after each scan. The workflow calls TrustRegistry.recordScan() on Base Sepolia, creating a permanent onchain trust record.</p>
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
        </div>
      </details>
    </div>
  `);
}

function HowItWorks() {
  const steps = [
    { num: "1", title: "Scan", desc: "40-rule agent-readiness scan (SSRF-guarded, free dry-run)" },
    { num: "2", title: "Confirm", desc: "Dry-run preview shows exactly what lands onchain (functionArgs), then confirm" },
    { num: "3", title: "Record", desc: "KeeperHub executes the workflow: TrustRegistry.recordScan onchain, tx on Basescan" },
    { num: "4", title: "Verify", desc: "Audit trail (live SSE) + keeperhub-audit MCP tool; agents pay via x402 (USDC)" },
  ];

  return sectionWrapper("howitworks", "", html`
    <h2 class="text-2xl font-bold text-white">How it works</h2>
    <div class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      ${raw(steps.map((s) => html`
        <div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-6">
          <div class="flex items-center gap-3">
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">${s.num}</span>
            <h3 class="text-lg font-semibold text-white">${s.title}</h3>
          </div>
          <p class="mt-3 text-sm text-slate-400">${s.desc}</p>
        </div>
      `).join(""))}
    </div>
  `);
}

function DemoSection() {
  const demoScript = raw(`
    <script>
      (function() {
        var form = document.getElementById("kh-demo-form");
        var runBtn = document.getElementById("kh-run");
        var quickBtn = document.getElementById("kh-quick");
        var confirmBtn = document.getElementById("kh-confirm");
        var statusEl = document.getElementById("kh-status");
        var resultEl = document.getElementById("kh-result");
        var executedEl = document.getElementById("kh-executed");
        var errorEl = document.getElementById("kh-error");
        var lastScan = null;
        var lastQuick = false;

        function setState(state, msg) {
          statusEl.hidden = false;
          errorEl.hidden = true;
          resultEl.hidden = true;
          executedEl.hidden = true;
          confirmBtn.hidden = true;

          if (state === "scanning") {
            statusEl.innerHTML = '<div class="flex items-center gap-3 text-slate-300"><svg class="animate-spin h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span>Scanning website…</span></div>';
          } else if (state === "dry-run") {
            statusEl.hidden = true;
            resultEl.hidden = false;
            confirmBtn.hidden = false;
          } else if (state === "executing") {
            statusEl.innerHTML = '<div class="flex items-center gap-3 text-slate-300"><svg class="animate-spin h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span>KeeperHub workflow executing… recording on TrustRegistry (may take up to 1 min)</span></div>';
          } else if (state === "done") {
            statusEl.hidden = true;
            executedEl.hidden = false;
          } else if (state === "exec-failed") {
            statusEl.hidden = true;
            executedEl.hidden = false;
          } else if (state === "error") {
            statusEl.hidden = true;
            errorEl.hidden = false;
            errorEl.innerHTML = '<div class="rounded-lg border border-red-800/50 bg-red-950/30 p-4"><p class="text-sm text-red-300">' + (msg || "Unknown error") + "</p></div>";
          }
        }

        function describeError(status, data) {
          if (status === 503) return "KeeperHub integration not enabled on this deployment";
          if (status === 403) return "Private or blocked URL (SSRF guard)";
          if (status === 400) return "Validation error: " + (data && data.error ? data.error : "bad request");
          if (status === 502) return "Workflow or provisioning issue — check KEEPERHUB_API_KEY / workflow IDs";
          return (data && data.error) ? data.error : "Network error — check connectivity";
        }

        function renderDryRun(data) {
          var s = data.scan;
          var gradeColor = s.grade === "A" ? "text-emerald-400" : s.grade === "B" ? "text-blue-400" : "text-amber-400";
          var depthBadge = s.depth === "quick"
            ? '<span class="ml-2 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300">quick</span>'
            : "";
          var html = '<div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-6">'
            + '<div class="flex items-center justify-between">'
            + '<div><span class="text-3xl font-bold ' + gradeColor + '">' + s.grade + '</span><span class="ml-2 text-slate-400">Grade</span>' + depthBadge + '</div>'
            + '<div class="text-right"><span class="text-3xl font-bold text-white">' + s.score + '</span><span class="ml-2 text-slate-400">/ 100</span></div>'
            + '</div>'
            + '<div class="mt-4 flex gap-6 text-sm text-slate-400"><span>' + s.rulesPassed + ' / ' + s.rulesTotal + ' rules passed</span></div>'
            + '<div class="mt-6 rounded-lg border border-slate-800 bg-slate-950/50 p-4">'
            + '<p class="text-xs font-mono text-slate-500 mb-2">wouldExecute — TrustRegistry.recordScan(siteUrl, score, rulesPassed, rulesTotal)</p>'
            + '<pre class="text-xs text-emerald-300 overflow-x-auto">[' + JSON.stringify(s.url) + ', ' + s.score + ', ' + s.rulesPassed + ', ' + s.rulesTotal + ']</pre>'
            + '</div></div>';
          resultEl.innerHTML = html;
        }

        function renderExecuted(data) {
          var links = (data.txHashes || []).map(function(h) {
            return '<a href="https://sepolia.basescan.org/tx/' + h + '" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono text-sm">' + h + '</a>';
          }).join("<br>");
          executedEl.innerHTML = '<div class="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-6">'
            + '<div class="flex items-center gap-3"><svg class="h-6 w-6 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><h3 class="text-lg font-bold text-white">Recorded onchain</h3></div>'
            + '<p class="mt-3 text-sm text-slate-400">Execution ID: <code class="text-slate-300">' + data.executionId + '</code></p>'
            + '<div class="mt-4"><p class="text-xs text-slate-500 mb-2">Transaction hashes:</p>' + (links || '<p class="text-sm text-slate-500">No tx hashes returned</p>') + '</div></div>';
        }

        function renderExecFailed(data) {
          executedEl.innerHTML = '<div class="rounded-xl border border-amber-800/40 bg-amber-950/20 p-6">'
            + '<div class="flex items-center gap-3"><svg class="h-6 w-6 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg><h3 class="text-lg font-bold text-white">Scan recorded, onchain leg failed</h3></div>'
            + '<p class="mt-3 text-sm text-amber-300">' + (data.error || "Unknown error") + '</p>'
            + '<p class="mt-2 text-xs text-slate-500">Execution ID: <code>' + data.executionId + '</code></p></div>';
        }

        async function runScan(quick) {
          setState("scanning");
          try {
            var res = await fetch("/api/keeperhub/scan", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: document.getElementById("kh-url").value, quick: quick }),
            });
            var data = await res.json();
            if (!res.ok) { setState("error", describeError(res.status, data)); return; }
            lastScan = data.scan;
            lastQuick = quick;
            renderDryRun(data);
            setState("dry-run");
          } catch (err) { setState("error", err.message); }
        }

        form.addEventListener("submit", function(e) {
          e.preventDefault();
          runScan(false);
        });

        quickBtn.addEventListener("click", function() {
          if (!document.getElementById("kh-url").value) {
            document.getElementById("kh-url").reportValidity();
            return;
          }
          runScan(true);
        });

        confirmBtn.addEventListener("click", async function() {
          if (!lastScan) return;
          setState("executing");
          try {
            var res = await fetch("/api/keeperhub/scan", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: lastScan.url, confirm: true, quick: lastQuick }),
            });
            var data = await res.json();
            if (data.mode === "executed") { renderExecuted(data); setState("done"); }
            else if (data.mode === "failed") { renderExecFailed(data); setState("exec-failed"); }
            else { setState("error", describeError(res.status, data)); }
          } catch (err) { setState("error", err.message); }
        });
      })();
    </script>
  `);

  return html`<section id="demo" class="mx-auto max-w-4xl px-6 py-16 sm:px-8 lg:px-12">
    <h2 class="text-2xl font-bold text-white">Try it: scan → onchain record</h2>
    <p class="mt-2 text-slate-400">One POST away from a permanent onchain trust record.</p>

    <form id="kh-demo-form" class="mt-8 space-y-4">
      <div>
        <label for="kh-url" class="block text-sm font-medium text-slate-300">Website URL</label>
        <input id="kh-url" name="url" type="url" required placeholder="https://example.com"
          class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="button" id="kh-quick"
          class="rounded-lg border border-indigo-500/50 bg-indigo-600/20 px-6 py-3 text-sm font-semibold text-indigo-300 hover:bg-indigo-600/40 transition">
          Quick check (~15s)
        </button>
        <button type="submit" id="kh-run"
          class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">
          Full scan (~2min)
        </button>
        <button type="button" id="kh-confirm" hidden
          class="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition">
          Record onchain (Base Sepolia)
        </button>
      </div>
    </form>

    <div id="kh-status" hidden class="mt-6"></div>
    <div id="kh-result" hidden class="mt-6"></div>
    <div id="kh-executed" hidden class="mt-6"></div>
    <div id="kh-error" hidden class="mt-6"></div>

    <div class="mt-12 border-t border-slate-800 pt-6">
      <p class="text-sm text-slate-400">
        Agents can pay per onchain record via x402 (USDC on Base):
        <code class="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-emerald-300">POST /api/keeperhub/scan/premium</code>
      </p>
    </div>

    ${demoScript}
  </section>`;
}

function AuditSectionAnchor() {
  const auditStyle = raw(`
    <style>
      @keyframes kh-fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      .kh-row-fade { animation: kh-fade 0.4s ease-out; }
      .kh-dot-live { background-color: rgb(52 211 153); animation: kh-pulse 2s infinite; }
      .kh-dot-poll { background-color: rgb(251 191 36); }
      .kh-dot-off { background-color: rgb(71 85 105); }
      @keyframes kh-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    </style>
  `);

  const auditScript = raw(`
    <script>
      (function () {
        var rows = document.getElementById("kh-audit-rows");
        var dot = document.getElementById("kh-live-dot");
        var emptyEl = document.getElementById("kh-audit-empty");
        var errorEl = document.getElementById("kh-audit-error");
        var explorerTemplate = null;
        var pollTimer = null;
        var sseFailures = 0;
        var pendingEvents = [];
        var seenIds = new Set();

        function setDot(state) {
          dot.className = "inline-block h-2.5 w-2.5 rounded-full " +
            (state === "live" ? "kh-dot-live" : state === "poll" ? "kh-dot-poll" : "kh-dot-off");
        }

        function showEmpty() {
          if (!rows.children.length) emptyEl.hidden = false;
        }
        function hideEmpty() {
          emptyEl.hidden = true;
        }
        function showError(msg) {
          errorEl.hidden = false;
          errorEl.innerHTML = '<div class="rounded-lg border border-red-800/50 bg-red-950/30 p-4"><p class="text-sm text-red-300">' + (msg || "Audit stream unavailable") + "</p></div>";
        }
        function hideError() {
          errorEl.hidden = true;
        }

        function esc(s) {
          if (!s) return "";
          var d = document.createElement("div");
          d.textContent = String(s);
          return d.innerHTML;
        }

        function statusIcon(status) {
          if (status === "recorded") return '<span class="text-emerald-400" title="recorded">●</span>';
          if (status === "minted") return '<span class="text-indigo-400" title="minted">★</span>';
          if (status === "failed") return '<span class="text-red-400" title="failed">✕</span>';
          return '<span class="text-slate-500">○</span>';
        }

        function scoreBadge(score) {
          if (score == null) return '<span class="text-slate-500">—</span>';
          var cls = score >= 85 ? "text-emerald-400" : score >= 60 ? "text-blue-400" : "text-amber-400";
          return '<span class="' + cls + ' font-bold">' + score + '</span>';
        }

        function txLinks(hashes) {
          if (!hashes || !hashes.length) return '<span class="text-slate-500">—</span>';
          return hashes.map(function(h) {
            var href = explorerTemplate ? explorerTemplate.replace("{hash}", h) : "#";
            return '<a class="text-emerald-400 hover:underline font-mono text-xs" target="_blank" rel="noopener" href="' + href + '">' + h.slice(0,10) + '…' + h.slice(-6) + ' ↗</a>';
          }).join(" ");
        }

        function timeAgo(ts) {
          if (!ts) return "—";
          var diff = Date.now() - new Date(ts).getTime();
          var mins = Math.floor(diff / 60000);
          if (mins < 1) return "just now";
          if (mins < 60) return mins + "m ago";
          var hrs = Math.floor(mins / 60);
          if (hrs < 24) return hrs + "h ago";
          return Math.floor(hrs / 24) + "d ago";
        }

        function renderEvent(e, prepend) {
          if (seenIds.has(e.id)) return;
          seenIds.add(e.id);
          var tr = document.createElement("tr");
          tr.setAttribute("data-id", e.id);
          tr.className = "kh-row-fade";
          tr.innerHTML =
            '<td class="py-3 pr-4 text-center">' + statusIcon(e.status) + '</td>' +
            '<td class="py-3 pr-4 text-sm text-slate-300">' + esc(e.siteUrl || "—") + '</td>' +
            '<td class="py-3 pr-4">' + scoreBadge(e.score) + '</td>' +
            '<td class="py-3 pr-4">' + txLinks(e.txHashes) + '</td>' +
            '<td class="py-3 text-xs text-slate-500">' + timeAgo(e.receivedAt) + '</td>';
          if (prepend) {
            rows.prepend(tr);
          } else {
            rows.append(tr);
          }
          while (rows.children.length > 50) {
            rows.removeChild(rows.lastChild);
          }
        }

        function flushPending() {
          while (pendingEvents.length) {
            renderEvent(pendingEvents.shift(), false);
          }
        }

        function startPolling() {
          if (pollTimer) return;
          setDot("poll");
          pollTimer = setInterval(function() {
            fetch("/api/keeperhub/audit?limit=20")
              .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
              .then(function(data) {
                if (data.explorer && data.explorer.txUrlTemplate) explorerTemplate = data.explorer.txUrlTemplate;
                (data.events || []).forEach(function(e) { renderEvent(e, false); });
                hideEmpty();
              })
              .catch(function() {});
          }, 30000);
        }

        function stopPolling() {
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        }

        function scheduleReconnect() {
          sseFailures++;
          if (sseFailures >= 3) {
            stopPolling();
            startPolling();
            return;
          }
          setTimeout(function() { connect(); }, Math.min(1000 * sseFailures, 10000));
        }

        function connect() {
          try {
            var es = new EventSource("/api/keeperhub/audit/stream");
            es.addEventListener("snapshot", function(ev) {
              setDot("live");
              sseFailures = 0;
              stopPolling();
              var data = JSON.parse(ev.data);
              if (data.events) {
                data.events.forEach(function(e) {
                  if (!seenIds.has(e.id)) pendingEvents.push(e);
                });
              }
              if (explorerTemplate) flushPending();
              if (rows.children.length) hideEmpty();
            });
            es.addEventListener("audit", function(ev) {
              setDot("live");
              sseFailures = 0;
              stopPolling();
              var e = JSON.parse(ev.data);
              if (explorerTemplate) {
                renderEvent(e, true);
                hideEmpty();
              } else {
                pendingEvents.push(e);
              }
            });
            es.onerror = function() {
              es.close();
              scheduleReconnect();
            };
          } catch (e) {
            scheduleReconnect();
          }
        }

        fetch("/api/keeperhub/audit?limit=20")
          .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
          .then(function(data) {
            if (data.explorer && data.explorer.txUrlTemplate) explorerTemplate = data.explorer.txUrlTemplate;
            (data.events || []).forEach(function(e) { renderEvent(e, false); });
            if (!rows.children.length) showEmpty();
            connect();
          })
          .catch(function(status) {
            if (status === 503) {
              showError("KeeperHub integration not enabled — audit trail unavailable");
            } else {
              showError("Failed to load audit trail");
            }
            setDot("off");
          });
      })();
    </script>
  `);

  return html`<section id="audit" class="border-y border-slate-700/50 bg-slate-900/30">
    <div class="mx-auto max-w-6xl px-6 py-16 sm:px-8 lg:px-12">
      <div class="flex items-center gap-3">
        <h2 class="text-2xl font-bold text-white">Live Audit Trail</h2>
        <span id="kh-live-dot" class="inline-block h-2.5 w-2.5 rounded-full kh-dot-off"></span>
      </div>
      <p class="mt-2 text-slate-400">Onchain records, streamed as they happen.</p>

      <div id="kh-audit-error" hidden class="mt-6"></div>
      <div id="kh-audit-empty" hidden class="mt-6 rounded-xl border border-slate-700/40 bg-slate-900/30 p-8 text-center">
        <p class="text-slate-400">No onchain records yet — run the demo above ↑</p>
      </div>

      <table id="kh-audit-table" class="mt-6 w-full border border-slate-700/50 divide-y divide-slate-700/50">
        <thead>
          <tr class="text-left text-xs text-slate-400">
            <th class="py-3 pr-4 font-medium">Status</th>
            <th class="py-3 pr-4 font-medium">Site</th>
            <th class="py-3 pr-4 font-medium">Score</th>
            <th class="py-3 pr-4 font-medium">Tx</th>
            <th class="py-3 font-medium">Recorded</th>
          </tr>
        </thead>
        <tbody id="kh-audit-rows"></tbody>
      </table>

      <p class="mt-4 text-xs text-slate-500">Source: TrustRegistry on Base Sepolia · each Tx links to Basescan</p>
    </div>
    ${auditStyle}
    ${auditScript}
  </section>`;
}

function StackSection() {
  const chips = [
    { label: "KeeperHub MCP", desc: "workflow engine, org key" },
    { label: "Base Sepolia", desc: "84532, Basescan" },
    { label: "TrustRegistry / TrustBadge", desc: "Solidity 0.8.30, OZ 5.1" },
    { label: "x402 v2", desc: "EIP-3009 USDC, facilitator" },
    { label: "MCP tools", desc: "4 keeperhub-* tools" },
    { label: "SSE", desc: "live audit stream" },
    { label: "Hono + hono/html", desc: "server-rendered, zero client framework" },
  ];

  return sectionWrapper("stack", "", html`
    <h2 class="text-2xl font-bold text-white">Stack</h2>
    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      ${raw(chips.map((c) => html`
        <div class="rounded-lg border border-slate-700/40 bg-slate-900/50 p-4">
          <div class="text-sm font-mono font-semibold text-indigo-300">${c.label}</div>
          <div class="mt-1 text-xs text-slate-400">${c.desc}</div>
        </div>
      `).join(""))}
    </div>
  `);
}

function ApiSection(opts?: KeeperHubPageOpts) {
  const basescanBase = "https://sepolia.basescan.org";
  const registryLink = opts?.registryAddress
    ? html`<a href="${basescanBase}/address/${opts.registryAddress}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono text-xs">${opts.registryAddress}</a>`
    : html`<span class="text-xs text-slate-500">—</span>`;
  const badgeLink = opts?.badgeAddress
    ? html`<a href="${basescanBase}/address/${opts.badgeAddress}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono text-xs">${opts.badgeAddress}</a>`
    : html`<span class="text-xs text-slate-500">—</span>`;

  return sectionWrapper("api", "", html`
    <h2 class="text-2xl font-bold text-white">API Surface</h2>
    <p class="mt-2 text-slate-400">Every public endpoint and MCP tool from Phase C/D.</p>

    <div class="mt-8 overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-700 text-left text-xs text-slate-400">
            <th class="pb-3 pr-4 font-medium">Surface</th>
            <th class="pb-3 pr-4 font-medium">Endpoint / Tool</th>
            <th class="pb-3 pr-4 font-medium">Auth</th>
            <th class="pb-3 font-medium">Returns</th>
          </tr>
        </thead>
        <tbody class="text-slate-300">
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">Scan (free)</td>
            <td class="py-3 pr-4 font-mono text-xs text-indigo-300">POST /api/keeperhub/scan</td>
            <td class="py-3 pr-4 text-xs text-slate-400">—</td>
            <td class="py-3 text-xs">dry-run preview or onchain tx</td>
          </tr>
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">Scan (premium)</td>
            <td class="py-3 pr-4 font-mono text-xs text-emerald-300">POST /api/keeperhub/scan/premium</td>
            <td class="py-3 pr-4 text-xs text-slate-400">x402 · $0.01</td>
            <td class="py-3 text-xs">onchain tx (paid via USDC)</td>
          </tr>
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">Audit API</td>
            <td class="py-3 pr-4 font-mono text-xs text-indigo-300">GET /api/keeperhub/audit</td>
            <td class="py-3 pr-4 text-xs text-slate-400">—</td>
            <td class="py-3 text-xs">events + onchain + Basescan links</td>
          </tr>
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">Live stream</td>
            <td class="py-3 pr-4 font-mono text-xs text-indigo-300">GET /api/keeperhub/audit/stream</td>
            <td class="py-3 pr-4 text-xs text-slate-400">—</td>
            <td class="py-3 text-xs">event: audit frames (SSE)</td>
          </tr>
          <tr class="border-b border-slate-800">
            <td class="py-3 pr-4">MCP tools</td>
            <td class="py-3 pr-4 font-mono text-xs text-indigo-300">keeperhub-record-scan · mint-trust-badge · workflow-status · audit</td>
            <td class="py-3 pr-4 text-xs text-slate-400">MCP session</td>
            <td class="py-3 text-xs">via AgentBadge MCP server</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-6 flex flex-wrap gap-6 text-xs text-slate-400">
      <a href="https://github.com/agentbadge/agentbadge" target="_blank" rel="noopener" class="hover:text-slate-200">GitHub repo ↗</a>
      <span>Contracts on Basescan:</span>
      <span>TrustRegistry: ${registryLink}</span>
      <span>TrustBadge: ${badgeLink}</span>
      <a href="https://dorahacks.io" target="_blank" rel="noopener" class="hover:text-slate-200">DoraHacks BUIDL ↗</a>
    </div>
  `);
}

function FooterCta() {
  return html`<section class="border-t border-slate-700/50 bg-slate-950">
    <div class="mx-auto max-w-4xl px-6 py-16 text-center sm:px-8 lg:px-12">
      <h2 class="text-2xl font-bold text-white">Run the demo above</h2>
      <p class="mt-3 text-slate-400">A permanent onchain record is 30 seconds away.</p>
      <div class="mt-6 flex justify-center gap-4">
        <a href="#demo" class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">Try the demo →</a>
        <a href="#audit" class="rounded-lg border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-400 transition">Live audit trail →</a>
      </div>
      <p class="mt-8 text-xs text-slate-500">
        Support: <a href="mailto:support@agentbadge.xyz" class="text-slate-400 hover:text-slate-200">support@agentbadge.xyz</a>
      </p>
    </div>
  </section>`;
}
