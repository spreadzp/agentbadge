// EPIC-202 (SLICE-202-8): Agent Allowance hackathon page — hero + architecture (fxdelta pattern).
import { html, raw } from "hono/html";
import { sectionWrapper } from "./shared";

const CLAIM_TX =
  "0x5a29b45d133338516ca88ad96017bc8ec79a8ef206b6d5767a74956f6c8509b5";
const EXPLORER_TX = `https://explorer.arc.io/tx/${CLAIM_TX}`;

export function Hero() {
  return html`<section class="relative overflow-hidden border-b border-slate-700/50 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-indigo-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <span class="inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium text-indigo-300">
          Agent Allowance · Arc Mainnet · USDC Streams · ERC-8004
        </span>
        <div class="mt-6 inline-flex items-center gap-4 rounded-2xl border border-slate-600/50 bg-slate-800/40 px-6 py-3 backdrop-blur-sm">
          <div class="flex flex-col items-center gap-1">
            <img src="/images/hackathons/agentallowance/agentBadge.png" alt="AgentBadge" class="h-10 w-10 rounded-lg" />
            <span class="text-[10px] font-medium text-slate-400">AgentBadge</span>
          </div>
          <div class="flex flex-col items-center">
            <svg class="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8m0 0l-3-3m3 3l-3 3M16 17H8m0 0l3-3m-3 3l3 3" />
            </svg>
            <span class="text-[9px] text-indigo-400 font-mono">vests</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <img src="/images/hackathons/agentallowance/arc.png" alt="Arc" class="h-9 w-auto rounded" />
            <span class="text-[10px] font-medium text-slate-400">Arc mainnet</span>
          </div>
        </div>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          Agent Allowance
        </h1>
        <p class="mt-6 text-lg text-slate-300 sm:text-xl">
          Onchain USDC budget vaults for AI agents. The owner funds a vault once — funds vest linearly Sablier-style — and the agent can only claim what already vested, only to allowlisted payees, within a per-transaction cap. Live on Arc mainnet.
        </p>
        <div class="mt-8 flex flex-wrap justify-center gap-4">
          <a href="#proof" class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">
            Mainnet proof →
          </a>
          <a href="${EXPLORER_TX}" target="_blank" rel="noopener" class="rounded-lg border border-emerald-600/60 px-6 py-3 text-sm font-semibold text-emerald-300 hover:border-emerald-400 transition">
            Live claim tx ↗
          </a>
          <a href="https://github.com/spreadzp/agent-budget-vault" target="_blank" rel="noopener" class="rounded-lg border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-400 transition">
            GitHub ↗
          </a>
        </div>
        <div class="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">3</div>
            <div class="text-xs text-slate-400">verified claims on mainnet</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">5042</div>
            <div class="text-xs text-slate-400">Arc mainnet chain ID</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">Sablier</div>
            <div class="text-xs text-slate-400">linear USDC vesting</div>
          </div>
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
            <div class="text-2xl font-bold text-white">46/46</div>
            <div class="text-xs text-slate-400">Foundry tests green</div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function ArchitectureDiagram() {
  const svgStyle = raw('<style>\n      @keyframes dash-flow { to { stroke-dashoffset: -20; } }\n      .flow-line { stroke-dasharray: 6 4; animation: dash-flow 1s linear infinite; }\n      .flow-line-branch { stroke-dasharray: 6 4; animation: dash-flow 1.5s linear infinite; }\n      .node-rect { fill: rgb(30 41 59 / 0.7); stroke-width: 1.5; rx: 10; }\n      .node-label { fill: rgb(255 255 255); font-size: 13px; font-weight: 700; text-anchor: middle; }\n      .node-desc { fill: rgb(125 211 252); font-size: 10px; text-anchor: middle; }\n      .node-tag { fill: rgb(196 181 253); font-size: 9px; font-family: monospace; text-anchor: middle; }\n      .arrow-label { fill: rgb(252 211 77); font-size: 10px; font-weight: 600; text-anchor: middle; }\n      .ref-line { stroke-dasharray: 2 4; opacity: 0.55; }\n    </style>');

  return sectionWrapper("architecture", "", html`
    <h2 class="text-2xl font-bold text-white">Architecture</h2>
    <p class="mt-2 text-slate-100">One funded vault, one enforced policy. Every write below is a real transaction on Arc mainnet (chainId 5042).</p>

    <div class="mt-8 overflow-x-auto">
      <svg viewBox="0 0 900 405" class="mx-auto w-full max-w-4xl" xmlns="http://www.w3.org/2000/svg">
        ${svgStyle}

        <defs>
          <marker id="aa-arrow-indigo" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgb(99 102 241)" />
          </marker>
          <marker id="aa-arrow-emerald" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgb(34 197 94)" />
          </marker>
          <marker id="aa-arrow-purple" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgb(168 85 247)" />
          </marker>
          <marker id="aa-arrow-amber" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgb(245 158 11)" />
          </marker>
        </defs>

        <!-- AgentBadge group container (dashed border highlights our components) -->
        <rect x="195" y="20" width="600" height="370" rx="12"
              fill="rgb(99 102 241 / 0.05)" stroke="rgb(99 102 241)" stroke-width="1.5"
              stroke-dasharray="8 4" opacity="0.7" />
        <rect x="200" y="11" width="120" height="20" rx="4"
              fill="rgb(15 23 42)" stroke="rgb(99 102 241)" stroke-width="1" />
        <text x="260" y="25" fill="rgb(199 210 254)" font-size="10" font-weight="700" text-anchor="middle">⚡ AgentBadge</text>

        <!-- Row 1: funding rail — Owner → Factory → Vault → Payee -->
        <rect class="node-rect" x="10" y="40" width="140" height="60" stroke="rgb(99 102 241)" />
        <text class="node-label" x="80" y="62">Owner</text>
        <text class="node-desc" x="80" y="78">human / multisig / ops</text>
        <text class="node-tag" x="80" y="92">controls policy</text>

        <line class="flow-line" x1="155" y1="70" x2="195" y2="70" stroke="rgb(99 102 241)" stroke-width="2" marker-end="url(#aa-arrow-indigo)" />
        <text class="arrow-label" x="175" y="58">1. create</text>
        <text class="arrow-label" x="175" y="94" fill="rgb(148 163 184)">agentId</text>

        <rect class="node-rect" x="200" y="40" width="160" height="60" stroke="rgb(34 197 94)" />
        <text class="node-label" x="280" y="62">VaultFactory</text>
        <text class="node-desc" x="280" y="78">deploys + registry</text>
        <text class="node-tag" x="280" y="92">0x5D1a…acA4</text>

        <line class="flow-line" x1="365" y1="70" x2="405" y2="70" stroke="rgb(34 197 94)" stroke-width="2" marker-end="url(#aa-arrow-emerald)" />
        <text class="arrow-label" x="385" y="62">2. deploy</text>

        <rect class="node-rect" x="410" y="40" width="170" height="60" stroke="rgb(245 158 11)" />
        <text class="node-label" x="495" y="62">BudgetVault</text>
        <text class="node-desc" x="495" y="78">USDC · rate = amt / 30d</text>
        <text class="node-tag" x="495" y="92">0x2860…Ff52</text>

        <line class="flow-line" x1="585" y1="70" x2="615" y2="70" stroke="rgb(245 158 11)" stroke-width="2" marker-end="url(#aa-arrow-amber)" />
        <text class="arrow-label" x="600" y="58">5. pay</text>
        <text class="arrow-label" x="600" y="94" fill="rgb(196 181 253)">USDC</text>

        <rect class="node-rect" x="620" y="40" width="170" height="60" stroke="rgb(168 85 247)" />
        <text class="node-label" x="705" y="62">Payee (Vendor)</text>
        <text class="node-desc" x="705" y="78">allowlisted address</text>
        <text class="node-tag" x="705" y="92">0x9a66…95A5</text>

        <!-- Deposit curve: Owner → Vault -->
        <path class="flow-line-branch" d="M 80 105 L 80 135 L 495 135 L 495 105" fill="none" stroke="rgb(99 102 241)" stroke-width="2" marker-end="url(#aa-arrow-indigo)" />
        <text class="arrow-label" x="288" y="128">3. approve + deposit USDC → vesting starts</text>

        <!-- Row 2: claim rail — Agent → Guards → (up to Vault) -->
        <rect class="node-rect" x="10" y="210" width="140" height="60" stroke="rgb(6 182 212)" />
        <text class="node-label" x="80" y="232">AI Agent</text>
        <text class="node-desc" x="80" y="248">0xcdd2…699d</text>
        <text class="node-tag" x="80" y="262">ERC-8004 id 2</text>

        <line class="flow-line" x1="155" y1="240" x2="195" y2="240" stroke="rgb(6 182 212)" stroke-width="2" marker-end="url(#aa-arrow-indigo)" />
        <text class="arrow-label" x="175" y="232">4. claim</text>
        <text class="arrow-label" x="175" y="278" fill="rgb(148 163 184)">amt,payee</text>

        <rect class="node-rect" x="200" y="200" width="160" height="90" stroke="rgb(34 197 94)" />
        <text class="node-label" x="280" y="228">Guards</text>
        <text class="node-desc" x="280" y="244">payee allowlist</text>
        <text class="node-desc" x="280" y="259">per-tx cap</text>
        <text class="node-desc" x="280" y="274">vested−claimed·!paused</text>
        <text class="node-tag" x="280" y="288">onchain only</text>

        <path class="flow-line-branch" d="M 365 240 L 450 240 L 450 105" fill="none" stroke="rgb(34 197 94)" stroke-width="2" marker-end="url(#aa-arrow-emerald)" />
        <text class="arrow-label" x="410" y="228" transform="rotate(0)">checks</text>

        <!-- Row 3: references -->
        <rect class="node-rect" x="10" y="330" width="140" height="55" stroke="rgb(6 182 212)" />
        <text class="node-label" x="80" y="352">ERC-8004</text>
        <text class="node-desc" x="80" y="368">agentId = 2</text>
        <line class="ref-line" x1="80" y1="275" x2="80" y2="325" stroke="rgb(6 182 212)" stroke-width="1.5" />

        <rect class="node-rect" x="200" y="330" width="160" height="55" stroke="rgb(99 102 241)" />
        <text class="node-label" x="280" y="352">Owner controls</text>
        <text class="node-desc" x="280" y="368">pause · cancel → unvested ↩</text>
        <line class="ref-line" x1="280" y1="295" x2="280" y2="325" stroke="rgb(99 102 241)" stroke-width="1.5" />

        <rect class="node-rect" x="410" y="330" width="170" height="55" stroke="rgb(34 197 94)" />
        <text class="node-label" x="495" y="352">Three-role UI</text>
        <text class="node-desc" x="495" y="368">vite + wagmi · owner/agent/vendor</text>
        <line class="ref-line" x1="495" y1="105" x2="495" y2="325" stroke="rgb(34 197 94)" stroke-width="1.5" />

        <rect class="node-rect" x="620" y="330" width="170" height="55" stroke="rgb(245 158 11)" />
        <text class="node-label" x="705" y="352">explorer.arc.io</text>
        <text class="node-desc" x="705" y="368">every write auditable</text>
        <line class="ref-line" x1="705" y1="105" x2="705" y2="325" stroke="rgb(245 158 11)" stroke-width="1.5" />
      </svg>
    </div>

    <p class="mt-6 text-center text-xs text-slate-400">
      Arc mainnet (5042) — the claim leg is a real verified transaction:
      <a href="${EXPLORER_TX}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono">0x5a29b4…09b5 ↗</a>
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
          <p>Everything inside the dashed border is the Agent Allowance system we built and deployed on Arc mainnet:</p>
          <ul class="list-disc pl-5 space-y-2 text-slate-400">
            <li><strong class="text-emerald-300">VaultFactory</strong> — thin registry; <code class="text-amber-300">createVault(owner, agent, agentId, registry, operator)</code> deploys a fresh BudgetVault and indexes it in <code class="text-amber-300">vaults[]</code> / <code class="text-amber-300">vaultOf[agent]</code></li>
            <li><strong class="text-amber-300">BudgetVault</strong> — holds USDC, releases it linearly over the vesting duration (Sablier Lockup semantics); enforces every guard at claim time</li>
            <li><strong class="text-emerald-300">Guards</strong> — payee allowlist, per-transaction cap, vested−claimed balance, pause flag — all checked onchain, nothing trusted off-chain</li>
            <li><strong class="text-emerald-300">Three-role UI</strong> — Vite + wagmi frontend: Owner (create/fund/policy), Agent (claim), Vendor (payment scan) — the exact views shown in the demo video</li>
            <li><strong class="text-indigo-300">Owner</strong>, <strong class="text-cyan-300">Agent</strong>, <strong class="text-purple-300">Payee</strong>, ERC-8004 and the explorer are external actors/services</li>
          </ul>
        </div>
      </details>

      <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
        <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
          <span class="flex items-center gap-2">
            <span class="text-cyan-400">📋</span> Step-by-step vault lifecycle
          </span>
          <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
          <ol class="list-decimal pl-5 space-y-2 text-slate-400">
            <li><strong class="text-indigo-300">Create</strong> — the owner calls <code class="text-amber-300">createVault</code> on the factory with the agent address, its ERC-8004 <code class="text-amber-300">agentId</code> and optional operator</li>
            <li><strong class="text-purple-300">Configure</strong> — the owner allowlists payees and sets <code class="text-amber-300">perTxCap</code>; the agent cannot route funds anywhere else</li>
            <li><strong class="text-emerald-300">Fund</strong> — <code class="text-amber-300">approve + deposit(amount)</code> sets the linear vesting rate (amount / duration) — Sablier-style streaming</li>
            <li><strong class="text-cyan-300">Claim</strong> — the agent calls <code class="text-amber-300">claim(amount, payee)</code>; the contract checks allowlist, cap, vested−claimed and the pause flag, then transfers vested USDC straight to the payee</li>
            <li><strong class="text-amber-300">Verify</strong> — every deposit, payee change, cap change and claim lands on explorer.arc.io; vendors confirm incoming payments by scanning their own address</li>
            <li><strong class="text-indigo-300">Exit</strong> — owner can pause instantly, or cancel: the vault returns every unvested unit and closes the stream</li>
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
            <p class="font-medium text-slate-200">What problem does it solve?</p>
            <p class="mt-1 text-slate-400">x402-style agent payments exist, but a funded key is an unlimited budget. Agent Allowance turns the budget into code: an owner funds a vault once, and the agent can only spend what vested, to whom the owner approved, within the per-transaction cap — enforced by the contract, not by trusting the agent.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">How does the agent get its spending rate?</p>
            <p class="mt-1 text-slate-400">Depositing USDC starts linear vesting — the rate is <code class="text-amber-300">amount / duration</code> (Sablier Lockup semantics). Vested balances tick up continuously; the agent claims at any point and only up to <code class="text-amber-300">vested − claimed</code>.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">Where is the proof it works on mainnet?</p>
            <p class="mt-1 text-slate-400">The full lifecycle ran on Arc mainnet (chainId 5042): approve, deposit 3 USDC, addPayee, setPerTxCap and three separate claims to the vendor — see the tx table below, each row links to explorer.arc.io. Latest claim <a href="${EXPLORER_TX}" target="_blank" rel="noopener" class="text-emerald-400 hover:text-emerald-300 underline font-mono">0x5a29b4…09b5</a> at block 27082200.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">Can the owner claw money back?</p>
            <p class="mt-1 text-slate-400">Yes — <code class="text-amber-300">pause()</code> freezes new claims instantly, and <code class="text-amber-300">cancel()</code> returns all unvested USDC to the owner. What already vested stays claimable by the agent — Sablier semantics again.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">Does the agent hold any funds?</p>
            <p class="mt-1 text-slate-400">No. The agent calls <code class="text-amber-300">claim(amount, payee)</code> and the vault transfers directly to the approved payee address — the agent's key never custodies USDC.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">How does ERC-8004 fit in?</p>
            <p class="mt-1 text-slate-400">The vault stores the agent's ERC-8004 <code class="text-amber-300">agentId</code> (2 in the demo vault) for off-chain correlation — identity cards, service listings, x402 payment metadata — without gating claims on identity lookups.</p>
          </div>
          <div>
            <p class="font-medium text-slate-200">Was the contract reviewed?</p>
            <p class="mt-1 text-slate-400">46/46 Foundry tests green plus an external adversarial review (Arc Studio audit): 3 Critical and 3 High findings found and fixed before mainnet deploy.</p>
          </div>
        </div>
      </details>
    </div>
  `);
}
