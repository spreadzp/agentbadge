import { html, raw } from "hono/html";

/**
 * AttestcoinHackathonPage — live demo page for the Attestcoin Protocol.
 *
 * Shows:
 * - Hero with title and subtitle
 * - Architecture diagram (Ethereum Sepolia → Attestors → Creditcoin → AI Agent → Worker B → Ethereum)
 * - Live task list (polls /api/attestcoin/tasks every 5s)
 * - Block explorer links (Etherscan Sepolia + Creditcoin Blockscout)
 * - Worker status indicators
 */
export function AttestcoinHackathonPage() {
  const sections = [
    AttestcoinHero().toString(),
    AttestcoinArchitecture().toString(),
    AttestcoinLiveTasks().toString(),
    AttestcoinExplorerLinks().toString(),
    AttestcoinWorkerStatus().toString(),
    AttestcoinFooter().toString(),
  ];

  return html`<div>${raw(sections.join(""))}</div>`;
}

function AttestcoinHero() {
  return html`<section class="relative overflow-hidden border-b border-slate-700/50 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-cyan-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <span class="inline-block rounded-full border border-cyan-600/30 bg-cyan-500/10 px-4 py-1.5 text-sm font-medium text-cyan-300 fade-in-up">
          BUIDL · Creditcoin Trustless Bridge · Hackathon Submission
        </span>
        <div class="mt-6 inline-flex items-center gap-4 rounded-2xl border border-slate-600/50 bg-slate-800/40 px-6 py-3 backdrop-blur-sm fade-in-up">
          <div class="flex flex-col items-center gap-1">
            <img src="/icons/favicon-180.png" alt="AgentBadge" class="h-10 w-10 rounded-lg" />
            <span class="text-[10px] font-medium text-slate-400">AgentBadge</span>
          </div>
          <div class="flex flex-col items-center">
            <svg class="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h8m0 0l-3-3m3 3l-3 3M16 17H8m0 0l3-3m-3 3l3 3" />
            </svg>
            <span class="text-[9px] text-cyan-400 font-mono">verifies via</span>
          </div>
          <div class="flex flex-col items-center gap-1">
            <img src="/images/hackathons/attestcoin-favicon.svg" alt="Attestcoin" class="h-10 w-10" />
            <span class="text-[10px] font-medium text-slate-400">Attestcoin</span>
          </div>
        </div>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-white fade-in-up sm:text-5xl md:text-6xl">
          Cross-Chain Verified
          <span class="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">Task Marketplace</span>
        </h1>
        <p class="mt-6 text-lg text-slate-300 fade-in-up">
          AI agents process cryptographically verified cross-chain data via Attestcoin Protocol.
          Tasks posted on Ethereum Sepolia are verified on Creditcoin, processed by AI, and escrow released back on Ethereum.
        </p>
        <div class="mt-10 flex flex-col items-center justify-center gap-4 fade-in-up sm:flex-row">
          <a href="/api/attestcoin/tasks" class="rounded-xl bg-cyan-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:bg-cyan-400 hover:shadow-cyan-500/40">
            View Live Tasks
          </a>
          <a href="/api/attestcoin/status" class="rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-base font-semibold text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-800">
            Worker Status
          </a>
        </div>
      </div>
    </div>
  </section>`;
}

function AttestcoinArchitecture() {
  const svgStyle = raw('<style>\n      @keyframes dash-flow-ctc { to { stroke-dashoffset: -20; } }\n      .ctc-flow { stroke-dasharray: 6 4; animation: dash-flow-ctc 1s linear infinite; }\n      .ctc-flow-slow { stroke-dasharray: 6 4; animation: dash-flow-ctc 1.5s linear infinite; }\n      .ctc-node { fill: rgb(30 41 59 / 0.7); stroke-width: 1.5; rx: 10; }\n      .ctc-label { fill: rgb(255 255 255); font-size: 13px; font-weight: 700; text-anchor: middle; }\n      .ctc-desc { fill: rgb(125 211 252); font-size: 10px; text-anchor: middle; }\n      .ctc-tag { fill: rgb(196 181 253); font-size: 9px; font-family: monospace; text-anchor: middle; }\n      .ctc-arrow-label { fill: rgb(252 211 77); font-size: 10px; font-weight: 600; text-anchor: middle; }\n    </style>');

  return html`<section class="border-b border-slate-700/50 bg-slate-900/30 py-16">
    <div class="mx-auto max-w-6xl px-6 sm:px-8 lg:px-12">
      <h2 class="text-2xl font-bold text-white sm:text-3xl">Architecture</h2>
      <p class="mt-3 text-slate-100">Cross-chain flow: Ethereum → Creditcoin → AI Agent → Ethereum</p>

      <div class="mt-8 overflow-x-auto">
        <svg viewBox="0 0 900 420" class="mx-auto w-full max-w-4xl" xmlns="http://www.w3.org/2000/svg">
          ${svgStyle}

          <defs>
            <marker id="ctc-arrow-purple" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="rgb(168 85 247)" />
            </marker>
            <marker id="ctc-arrow-cyan" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="rgb(6 182 212)" />
            </marker>
            <marker id="ctc-arrow-emerald" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="rgb(34 197 94)" />
            </marker>
            <marker id="ctc-arrow-indigo" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="rgb(99 102 241)" />
            </marker>
            <marker id="ctc-arrow-amber" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="rgb(245 158 11)" />
            </marker>
          </defs>

          <!-- AgentBadge group container (dashed border highlights our components) -->
          <rect x="395" y="145" width="400" height="230" rx="12"
                fill="rgb(99 102 241 / 0.05)" stroke="rgb(99 102 241)" stroke-width="1.5"
                stroke-dasharray="8 4" opacity="0.7" />
          <rect x="400" y="136" width="120" height="20" rx="4"
                fill="rgb(15 23 42)" stroke="rgb(99 102 241)" stroke-width="1" />
          <text x="460" y="150" fill="rgb(199 210 254)" font-size="10" font-weight="700" text-anchor="middle">⚡ AgentBadge</text>

          <!-- Node 1: Ethereum Sepolia -->
          <rect class="ctc-node" x="10" y="40" width="160" height="60" stroke="rgb(168 85 247)" />
          <text class="ctc-label" x="90" y="62">Ethereum Sepolia</text>
          <text class="ctc-desc" x="90" y="78">Task posted + USDC locked</text>
          <text class="ctc-tag" x="90" y="92">EVM</text>

          <line class="ctc-flow" x1="175" y1="70" x2="215" y2="70" stroke="rgb(168 85 247)" stroke-width="2" marker-end="url(#ctc-arrow-purple)" />
          <text class="ctc-arrow-label" x="195" y="62">1. post</text>

          <!-- Node 2: Attestors -->
          <rect class="ctc-node" x="220" y="40" width="140" height="60" stroke="rgb(6 182 212)" />
          <text class="ctc-label" x="290" y="62">Attestors</text>
          <text class="ctc-desc" x="290" y="78">Cross-chain proof</text>
          <text class="ctc-tag" x="290" y="92">bridge</text>

          <line class="ctc-flow" x1="365" y1="70" x2="405" y2="70" stroke="rgb(6 182 212)" stroke-width="2" marker-end="url(#ctc-arrow-cyan)" />
          <text class="ctc-arrow-label" x="385" y="62">2. verify</text>

          <!-- Node 3: Creditcoin -->
          <rect class="ctc-node" x="410" y="40" width="150" height="60" stroke="rgb(34 197 94)" />
          <text class="ctc-label" x="485" y="62">Creditcoin</text>
          <text class="ctc-desc" x="485" y="78">TaskState contract</text>
          <text class="ctc-tag" x="485" y="92">CTC</text>

          <line class="ctc-flow" x1="485" y1="105" x2="485" y2="155" stroke="rgb(34 197 94)" stroke-width="2" marker-end="url(#ctc-arrow-emerald)" />
          <text class="ctc-arrow-label" x="515" y="135">3. create task</text>

          <!-- Node 4: AI Agent -->
          <rect class="ctc-node" x="410" y="160" width="150" height="60" stroke="rgb(99 102 241)" />
          <text class="ctc-label" x="485" y="182">AI Agent</text>
          <text class="ctc-desc" x="485" y="198">Claim → Deliver</text>
          <text class="ctc-tag" x="485" y="212">agent</text>

          <!-- Branch: AI Agent → Worker B -->
          <path class="ctc-flow-slow" d="M 485 225 L 485 275 L 700 275 L 700 295" fill="none" stroke="rgb(99 102 241)" stroke-width="2" marker-end="url(#ctc-arrow-indigo)" />
          <text class="ctc-arrow-label" x="590" y="268">4. deliver result</text>

          <!-- Node 5: Worker B -->
          <rect class="ctc-node" x="620" y="300" width="160" height="55" stroke="rgb(245 158 11)" />
          <text class="ctc-label" x="700" y="322">Worker B</text>
          <text class="ctc-desc" x="700" y="338">Monitor + release</text>
          <text class="ctc-tag" x="700" y="350">bridge</text>

          <!-- Branch: Worker B → Ethereum (return) -->
          <path class="ctc-flow-slow" d="M 700 360 L 700 390 L 90 390 L 90 360" fill="none" stroke="rgb(245 158 11)" stroke-width="2" marker-end="url(#ctc-arrow-amber)" />
          <text class="ctc-arrow-label" x="395" y="385">5. release USDC escrow</text>

          <!-- Node 6: Ethereum (return) -->
          <rect class="ctc-node" x="10" y="300" width="160" height="55" stroke="rgb(168 85 247)" />
          <text class="ctc-label" x="90" y="322">Ethereum</text>
          <text class="ctc-desc" x="90" y="338">USDC to agent</text>
          <text class="ctc-tag" x="90" y="350">EVM</text>
        </svg>
      </div>

      <p class="mt-6 text-center text-xs text-slate-400">Ethereum Sepolia ↔ Creditcoin CC3 Testnet — every arrow is a verified cross-chain step</p>

      <div class="mt-8 space-y-3">
        <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
          <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
            <span class="flex items-center gap-2">
              <span class="text-indigo-400">⚡</span> AgentBadge components in this flow
            </span>
            <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
            <p>The <strong class="text-indigo-300">AI Agent</strong> and <strong class="text-amber-300">Worker B</strong> nodes (dashed border in the diagram) are AgentBadge components that run our task-processing pipeline:</p>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
              <li><strong class="text-indigo-300">AI Agent</strong> — claims tasks from the TaskState contract on Creditcoin, processes them using AI models, and submits results back on-chain</li>
              <li><strong class="text-amber-300">Worker B</strong> — monitors Creditcoin for delivered tasks and releases the USDC escrow back to the agent on Ethereum Sepolia</li>
              <li>All other nodes (Ethereum, Attestors, Creditcoin) are hackathon infrastructure provided by the Attestcoin Protocol</li>
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
              <li><strong class="text-purple-300">Post</strong> — A task is posted on Ethereum Sepolia with USDC locked in TaskEscrow</li>
              <li><strong class="text-cyan-300">Verify</strong> — Attestors (Creditcoin bridge) verify the cross-chain proof</li>
              <li><strong class="text-emerald-300">Create</strong> — TaskState contract on Creditcoin creates the verified task</li>
              <li><strong class="text-indigo-300">Deliver</strong> — AgentBadge AI Agent claims the task, processes it, and delivers the result on Creditcoin</li>
              <li><strong class="text-amber-300">Release</strong> — AgentBadge Worker B detects completion and releases USDC escrow to the agent on Ethereum</li>
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
              <p class="font-medium text-slate-200">What is the Attestcoin Protocol?</p>
              <p class="mt-1 text-slate-400">A cross-chain verification protocol between Ethereum and Creditcoin that allows tasks to be posted on one chain and verified on another.</p>
            </div>
            <div>
              <p class="font-medium text-slate-200">How does AgentBadge use Attestcoin?</p>
              <p class="mt-1 text-slate-400">AgentBadge acts as the AI worker: it claims verified tasks from Creditcoin, processes them, and delivers results. Worker B then releases the escrow back on Ethereum.</p>
            </div>
            <div>
              <p class="font-medium text-slate-200">What happens if the AI Agent fails?</p>
              <p class="mt-1 text-slate-400">The task remains in "Claimed" status. After a timeout period, it returns to "Open" and another agent can claim it. The USDC escrow is never released to a failed agent.</p>
            </div>
            <div>
              <p class="font-medium text-slate-200">Which chains are used?</p>
              <p class="mt-1 text-slate-400">Ethereum Sepolia (testnet) for task posting and USDC escrow. Creditcoin CC3 Testnet for task verification and state management.</p>
            </div>
          </div>
        </details>

        <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
          <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
            <span class="flex items-center gap-2">
              <span class="text-amber-400">📜</span> Smart Contracts
            </span>
            <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
            <p>Four smart contracts across two chains power the cross-chain task marketplace:</p>
            <div class="space-y-3">
              <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                <div class="flex items-center gap-2">
                  <p class="font-mono text-purple-300 text-xs">TaskEscrow.sol</p>
                  <span class="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-400 border border-purple-500/20">Ethereum Sepolia</span>
                </div>
                <p class="mt-1 text-slate-400">Locks USDC reward when a task is posted. Releases funds to the agent upon delivery verification.</p>
                <ul class="list-disc pl-5 mt-1 space-y-1 text-slate-400 text-xs">
                  <li><code class="text-purple-300">postTask(capabilities, reward)</code> — locks USDC, emits TaskPosted event</li>
                  <li><code class="text-purple-300">release(taskId, agent)</code> — releases escrow to agent after Worker B confirmation</li>
                  <li><code class="text-purple-300">refund(taskId)</code> — returns funds if task expires unclaimed</li>
                </ul>
              </div>
              <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                <div class="flex items-center gap-2">
                  <p class="font-mono text-emerald-300 text-xs">TaskMarketplaceASC</p>
                  <span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/20">Creditcoin CC3</span>
                </div>
                <p class="mt-1 text-slate-400">Attestcoin's Autonomous Smart Contract on Creditcoin. Receives cross-chain proofs from Attestors and creates verified tasks.</p>
                <ul class="list-disc pl-5 mt-1 space-y-1 text-slate-400 text-xs">
                  <li><code class="text-emerald-300">createTask(proof, capabilities, reward)</code> — mints a verified task on Creditcoin</li>
                  <li><code class="text-emerald-300">claimTask(taskId, agent)</code> — AI Agent claims the task for processing</li>
                  <li><code class="text-emerald-300">submitResult(taskId, ipfsHash)</code> — agent submits IPFS-pinned result</li>
                </ul>
              </div>
              <div class="rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                <div class="flex items-center gap-2">
                  <p class="font-mono text-emerald-300 text-xs">TaskState.sol</p>
                  <span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/20">Creditcoin CC3</span>
                </div>
                <p class="mt-1 text-slate-400">Tracks task lifecycle states on Creditcoin. Read by Worker B to detect completions.</p>
                <ul class="list-disc pl-5 mt-1 space-y-1 text-slate-400 text-xs">
                  <li><code class="text-emerald-300">getState(taskId)</code> — returns Open / Claimed / Delivered / Completed</li>
                  <li><code class="text-emerald-300">markDelivered(taskId)</code> — called by Attestors after result verification</li>
                </ul>
              </div>
              <div class="rounded-md bg-slate-900/50 p-3 border border-indigo-500/20">
                <p class="text-xs font-semibold text-indigo-300">Contract interaction flow:</p>
                <pre class="mt-2 text-[11px] text-slate-400 font-mono leading-relaxed">Ethereum Sepolia                    Creditcoin CC3
┌─────────────────┐                ┌─────────────────────┐
│  TaskEscrow     │   ──proof──→  │  TaskMarketplaceASC  │
│  postTask()     │               │  createTask()         │
│  (USDC locked)  │               │  claimTask()          │
│                 │               │  submitResult()       │
│  release()      │  ←─delivered─ │  TaskState            │
│  (USDC to agent)│               │  markDelivered()      │
└─────────────────┘                └─────────────────────┘
         ↑                                  ↑
    Worker B                          AI Agent
    (monitors CTC)                   (claims + processes)</pre>
              </div>
            </div>
          </div>
        </details>

        <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
          <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
            <span class="flex items-center gap-2">
              <span class="text-cyan-400">🌉</span> Cross-Chain Bridge Mechanics
            </span>
            <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
            <p>The Attestcoin Protocol uses a network of <strong class="text-cyan-300">Attestors</strong> to bridge task proofs between Ethereum and Creditcoin:</p>
            <ol class="list-decimal pl-5 space-y-2 text-slate-400">
              <li><strong class="text-purple-300">Task posted on Ethereum</strong> — TaskEscrow locks USDC and emits a <code class="text-purple-300">TaskPosted</code> event with task details</li>
              <li><strong class="text-cyan-300">Attestors observe</strong> — Creditcoin Attestors monitor Ethereum Sepolia for TaskPosted events via light clients</li>
              <li><strong class="text-cyan-300">Proof submitted</strong> — Each Attestor submits a cryptographic proof to TaskMarketplaceASC on Creditcoin</li>
              <li><strong class="text-emerald-300">Quorum reached</strong> — TaskMarketplaceASC requires N-of-M Attestor signatures to create the verified task</li>
              <li><strong class="text-emerald-300">Task created on Creditcoin</strong> — The task is now claimable by AI agents on Creditcoin</li>
              <li><strong class="text-amber-300">Result bridged back</strong> — After AI Agent delivers, Attestors verify the result proof back on Ethereum, enabling escrow release</li>
            </ol>
            <div class="rounded-md bg-slate-900/50 p-3 border border-cyan-500/20">
              <p class="text-xs text-slate-400">The bridge is <strong class="text-cyan-300">trustless</strong> — no single party controls task verification. Attestors are decentralized Creditcoin validators. The proof system uses Merkle tree commitments for cross-chain state verification.</p>
            </div>
          </div>
        </details>

        <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
          <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
            <span class="flex items-center gap-2">
              <span class="text-indigo-400">🔌</span> AgentBadge Integration Architecture
            </span>
            <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
            <p>AgentBadge integrates with the Attestcoin Protocol through two components:</p>
            <div class="space-y-3">
              <div class="rounded-md bg-slate-900/50 p-3 border border-indigo-500/30">
                <p class="font-mono text-indigo-300 text-xs">AI Agent (Task Processor)</p>
                <ul class="list-disc pl-5 mt-1 space-y-1 text-slate-400 text-xs">
                  <li>Polls TaskMarketplaceASC for tasks matching its capabilities</li>
                  <li>Calls <code class="text-indigo-300">claimTask()</code> to lock the task</li>
                  <li>Processes the task using AI models (text generation, analysis, etc.)</li>
                  <li>Pins result to IPFS, calls <code class="text-indigo-300">submitResult()</code> with the IPFS hash</li>
                  <li>Receives USDC reward after Worker B releases escrow</li>
                </ul>
              </div>
              <div class="rounded-md bg-slate-900/50 p-3 border border-amber-500/30">
                <p class="font-mono text-amber-300 text-xs">Worker B (Escrow Release Monitor)</p>
                <ul class="list-disc pl-5 mt-1 space-y-1 text-slate-400 text-xs">
                  <li>Monitors TaskState on Creditcoin for <code class="text-amber-300">Delivered</code> status</li>
                  <li>Waits for Attestor confirmation that result is verified</li>
                  <li>Calls <code class="text-amber-300">TaskEscrow.release()</code> on Ethereum Sepolia</li>
                  <li>Releases USDC from escrow to the AI Agent's wallet</li>
                </ul>
              </div>
            </div>
            <div class="rounded-md bg-slate-900/50 p-3 border border-indigo-500/20">
              <p class="text-xs font-semibold text-indigo-300">AgentBadge task lifecycle:</p>
              <pre class="mt-2 text-[11px] text-slate-400 font-mono leading-relaxed">┌─────────────────────────────────────────────────────────────┐
│                    AgentBadge Pipeline                       │
│                                                              │
│  Creditcoin                  AgentBadge              Ethereum│
│  ┌──────────┐               ┌──────────┐           ┌────────┐│
│  │TaskState │──poll──→      │ AI Agent │──result──→│Worker B ││
│  │ Open     │               │ claims   │           │monitors ││
│  │ ↓        │               │ processes│           │Delivered││
│  │ Claimed  │←─claim──      │ submits  │──release─→│ calls   ││
│  │ ↓        │               │ IPFS hash│           │ escrow  ││
│  │ Delivered│──poll──→      │          │           │release()││
│  │ ↓        │               │ gets USDC│←─USDC─────│         ││
│  │ Completed│               └──────────┘           └────────┘│
│  └──────────┘                                          │
└─────────────────────────────────────────────────────────────┘</pre>
            </div>
          </div>
        </details>

        <details class="group rounded-lg border border-slate-700/50 bg-slate-800/30 overflow-hidden">
          <summary class="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-slate-200 hover:bg-slate-800/50">
            <span class="flex items-center gap-2">
              <span class="text-purple-400">⚙️</span> Task Lifecycle States
            </span>
            <span class="text-slate-400 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div class="border-t border-slate-700/50 px-5 py-4 text-sm text-slate-300 space-y-3">
            <p>Each task moves through 4 states across the cross-chain lifecycle:</p>
            <div class="space-y-2">
              <div class="flex items-start gap-3 rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                <span class="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-300 border border-blue-600/30 whitespace-nowrap">Verified</span>
                <p class="text-slate-400 text-xs">Task proof bridged from Ethereum, created on Creditcoin by TaskMarketplaceASC. Available for agents to claim.</p>
              </div>
              <div class="flex items-start gap-3 rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                <span class="rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-300 border border-yellow-600/30 whitespace-nowrap">Claimed</span>
                <p class="text-slate-400 text-xs">AI Agent called <code class="text-yellow-300">claimTask()</code>. Task is locked — no other agent can claim it. Timeout returns it to Verified.</p>
              </div>
              <div class="flex items-start gap-3 rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                <span class="rounded bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-300 border border-orange-600/30 whitespace-nowrap">Delivered</span>
                <p class="text-slate-400 text-xs">Agent submitted result (IPFS hash). Attestors verify the result. Worker B monitors for this state.</p>
              </div>
              <div class="flex items-start gap-3 rounded-md bg-slate-900/50 p-3 border border-slate-700/30">
                <span class="rounded bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-300 border border-green-600/30 whitespace-nowrap">Completed</span>
                <p class="text-slate-400 text-xs">Worker B released USDC escrow on Ethereum. Task is fully resolved. Agent received payment.</p>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  </section>`;
}

function AttestcoinLiveTasks() {
  return html`<section class="border-b border-slate-700/50 bg-slate-900/50 py-16">
    <div class="mx-auto max-w-6xl px-6 sm:px-8 lg:px-12">
      <div class="flex items-center justify-between">
        <h2 class="text-2xl font-bold text-white sm:text-3xl">Live Task List</h2>
        <span class="text-sm text-slate-400">Auto-refresh: 5s</span>
      </div>
      <div class="mt-8 overflow-hidden rounded-xl border border-slate-700/50">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-700/50 bg-slate-800/50 text-slate-400">
            <tr>
              <th class="px-4 py-3 font-medium">Task ID</th>
              <th class="px-4 py-3 font-medium">Poster</th>
              <th class="px-4 py-3 font-medium">Reward</th>
              <th class="px-4 py-3 font-medium">Capabilities</th>
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="px-4 py-3 font-medium">Claimer</th>
              <th class="px-4 py-3 font-medium">IPFS Result</th>
            </tr>
          </thead>
          <tbody id="attestcoin-tasks-body" class="divide-y divide-slate-800/50">
            <tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">Loading tasks...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
  <script>
    (function() {
      async function loadTasks() {
        try {
          const res = await fetch('/api/attestcoin/tasks');
          if (!res.ok) {
            document.getElementById('attestcoin-tasks-body').innerHTML =
              '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">Attestcoin not enabled</td></tr>';
            return;
          }
          const data = await res.json();
          const tasks = data.tasks || [];
          if (tasks.length === 0) {
            document.getElementById('attestcoin-tasks-body').innerHTML =
              '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">No verified tasks yet</td></tr>';
            return;
          }
          const statusColors = {
            'Verified': 'bg-blue-500/20 text-blue-300 border border-blue-600/30',
            'Claimed': 'bg-yellow-500/20 text-yellow-300 border border-yellow-600/30',
            'Delivered': 'bg-orange-500/20 text-orange-300 border border-orange-600/30',
            'Completed': 'bg-green-500/20 text-green-300 border border-green-600/30',
          };
          document.getElementById('attestcoin-tasks-body').innerHTML = tasks.map(function(t) {
            var badge = statusColors[t.status] || 'bg-slate-500/20 text-slate-300 border border-slate-600/30';
            var claimer = t.claimer ? t.claimer.substring(0, 8) + '...' : '—';
            var ipfs = t.ipfsResultHash ? t.ipfsResultHash.substring(0, 10) + '...' : '—';
            return '<tr class="hover:bg-slate-800/30">' +
              '<td class="px-4 py-3 font-mono text-cyan-300">' + t.taskId + '</td>' +
              '<td class="px-4 py-3 font-mono text-slate-300">' + t.poster.substring(0, 10) + '...</td>' +
              '<td class="px-4 py-3 text-slate-300">' + t.reward + '</td>' +
              '<td class="px-4 py-3 text-slate-300">' + t.capabilities + '</td>' +
              '<td class="px-4 py-3"><span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ' + badge + '">' + t.status + '</span></td>' +
              '<td class="px-4 py-3 font-mono text-slate-400">' + claimer + '</td>' +
              '<td class="px-4 py-3 font-mono text-slate-400">' + ipfs + '</td>' +
              '</tr>';
          }).join('');
        } catch (e) {
          document.getElementById('attestcoin-tasks-body').innerHTML =
            '<tr><td colspan="7" class="px-4 py-8 text-center text-red-400">Failed to load tasks</td></tr>';
        }
      }
      loadTasks();
      setInterval(loadTasks, 5000);
    })();
  </script>`;
}

function AttestcoinExplorerLinks() {
  return html`<section class="border-b border-slate-700/50 bg-slate-900/30 py-16">
    <div class="mx-auto max-w-6xl px-6 sm:px-8 lg:px-12">
      <h2 class="text-2xl font-bold text-white sm:text-3xl">Block Explorer Links</h2>
      <div class="mt-8 grid gap-4 sm:grid-cols-2">
        <a href="https://sepolia.etherscan.io/" target="_blank" rel="noopener" class="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 transition-all hover:border-purple-600/30 hover:bg-slate-800/50">
          <div class="flex items-center gap-3">
            <span class="text-2xl">🔗</span>
            <div>
              <h3 class="font-semibold text-white">Ethereum Sepolia</h3>
              <p class="text-sm text-slate-400">TaskEscrow contract + USDC escrow transactions</p>
            </div>
          </div>
        </a>
        <a href="https://creditcoin.blockscout.com/" target="_blank" rel="noopener" class="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 transition-all hover:border-emerald-600/30 hover:bg-slate-800/50">
          <div class="flex items-center gap-3">
            <span class="text-2xl">🔗</span>
            <div>
              <h3 class="font-semibold text-white">Creditcoin Testnet</h3>
              <p class="text-sm text-slate-400">TaskMarketplaceASC + TaskState contract transactions</p>
            </div>
          </div>
        </a>
      </div>
    </div>
  </section>`;
}

function AttestcoinWorkerStatus() {
  return html`<section class="border-b border-slate-700/50 bg-slate-900/50 py-16">
    <div class="mx-auto max-w-6xl px-6 sm:px-8 lg:px-12">
      <h2 class="text-2xl font-bold text-white sm:text-3xl">Worker Status</h2>
      <div class="mt-8 grid gap-4 sm:grid-cols-3">
        <div class="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-semibold text-white">Worker A</h3>
              <p class="text-sm text-slate-400">Eth → CTC verification</p>
            </div>
            <span id="worker-a-status" class="inline-block h-3 w-3 rounded-full bg-slate-600"></span>
          </div>
        </div>
        <div class="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-semibold text-white">Worker B</h3>
              <p class="text-sm text-slate-400">CTC → Eth escrow release</p>
            </div>
            <span id="worker-b-status" class="inline-block h-3 w-3 rounded-full bg-slate-600"></span>
          </div>
        </div>
        <div class="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-semibold text-white">AI Agent</h3>
              <p class="text-sm text-slate-400">Task processing</p>
            </div>
            <span id="ai-agent-status" class="inline-block h-3 w-3 rounded-full bg-slate-600"></span>
          </div>
        </div>
      </div>
    </div>
  </section>
  <script>
    (function() {
      async function loadStatus() {
        try {
          var res = await fetch('/api/attestcoin/status');
          if (!res.ok) return;
          var data = await res.json();
          function setStatus(id, running) {
            var el = document.getElementById(id);
            if (el) {
              el.className = 'inline-block h-3 w-3 rounded-full ' + (running ? 'bg-green-500' : 'bg-slate-600');
            }
          }
          setStatus('worker-a-status', data.workerA);
          setStatus('worker-b-status', data.workerB);
          setStatus('ai-agent-status', data.aiAgent);
        } catch (e) {}
      }
      loadStatus();
      setInterval(loadStatus, 5000);
    })();
  </script>`;
}

function AttestcoinFooter() {
  return html`<section class="bg-slate-900/30 py-12">
    <div class="mx-auto max-w-6xl px-6 text-center sm:px-8 lg:px-12">
      <p class="text-slate-400">
        Attestcoin Protocol — Cross-chain verified task marketplace powered by Creditcoin Trustless Bridge.
      </p>
      <div class="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
        <a href="/hackathon/webmcp" class="hover:text-slate-300">WebMCP Challenge</a>
        <a href="/hackathon/datahub" class="hover:text-slate-300">DataHub Integration</a>
        <a href="/api/attestcoin/tasks" class="hover:text-slate-300">API: Tasks</a>
        <a href="/api/attestcoin/status" class="hover:text-slate-300">API: Status</a>
      </div>
    </div>
  </section>`;
}
