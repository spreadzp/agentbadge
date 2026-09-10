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
  const steps = [
    { label: "Ethereum Sepolia", desc: "Task posted + USDC escrow locked", color: "text-purple-400", border: "border-purple-600/30" },
    { label: "Attestors", desc: "Cross-chain proof generation", color: "text-cyan-400", border: "border-cyan-600/30" },
    { label: "Creditcoin", desc: "Task verified + created on TaskState", color: "text-emerald-400", border: "border-emerald-600/30" },
    { label: "AI Agent", desc: "Claims, processes, delivers result", color: "text-indigo-400", border: "border-indigo-600/30" },
    { label: "Worker B", desc: "Monitors completion, releases escrow", color: "text-amber-400", border: "border-amber-600/30" },
    { label: "Ethereum", desc: "USDC escrow released to agent", color: "text-purple-400", border: "border-purple-600/30" },
  ];

  return html`<section class="border-b border-slate-700/50 bg-slate-900/30 py-16">
    <div class="mx-auto max-w-6xl px-6 sm:px-8 lg:px-12">
      <h2 class="text-2xl font-bold text-white sm:text-3xl">Architecture</h2>
      <p class="mt-3 text-slate-400">Cross-chain flow: Ethereum → Creditcoin → AI Agent → Ethereum</p>
      <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${steps.map((s, i) => html`<div class="rounded-xl border ${s.border} bg-slate-800/30 p-5">
          <div class="flex items-center gap-3">
            <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-sm font-bold ${s.color}">${i + 1}</span>
            <h3 class="font-semibold text-white">${s.label}</h3>
          </div>
          <p class="mt-2 text-sm text-slate-400">${s.desc}</p>
        </div>`).join("")}
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
