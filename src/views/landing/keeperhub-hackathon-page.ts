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

export function KeeperHubHackathonPage(opts?: KeeperHubPageOpts): HtmlEscapedString {
  return html`${Hero()}
    ${ArchitectureDiagram()}
    ${HowItWorks()}
    ${DemoSection()}
    ${AuditSectionAnchor()}
    ${StackSection()}
    ${ApiSection(opts)}
    ${FooterCta()}`;
}

function sectionWrapper(id: string, extraClass: string, content: HtmlEscapedString): HtmlEscapedString {
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
      </div>
    </div>
  </section>`;
}

function ArchitectureDiagram() {
  return sectionWrapper("architecture", "", html`
    <h2 class="text-2xl font-bold text-white">Architecture</h2>
    <p class="mt-2 text-slate-400">Every arrow is one verifiable transaction on Base Sepolia (84532).</p>

    <div class="mt-8 flex flex-col items-center gap-4">
      <div class="flex flex-wrap items-center justify-center gap-2">
        ${NodeCard("Site URL", "https", "web2")}
        ${Arrow()}
        ${NodeCard("AgentBadge Scan", "40 rules, score 0-100, any site", "web2")}
        ${Arrow()}
        ${NodeCard("KeeperHub Workflow", "webhook trigger, web3/write-contract", "MCP")}
        ${Arrow()}
        ${NodeCard("TrustRegistry", "recordScan() on Base", "EVM")}
        ${Arrow()}
        ${NodeCard("Audit Trail + SSE", "live feed + Basescan links", "SSE")}
      </div>

      <div class="flex items-center gap-2 text-slate-500">
        <span class="text-slate-600">│</span>
      </div>
      <p class="text-xs text-slate-500">▼ score ≥ 85 path</p>
      <div class="flex justify-center">
        ${NodeCard("TrustBadge mint", "soulbound ERC-721, SBT transfer-blocked", "ERC-721")}
      </div>
    </div>

    <p class="mt-6 text-center text-xs text-slate-500">Base Sepolia · testnet — every arrow is one verifiable tx</p>
  `);
}

function NodeCard(name: string, desc: string, tag: string): HtmlEscapedString {
  return html`<div class="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4 text-center">
    <div class="text-sm font-semibold text-white">${name}</div>
    <div class="mt-1 text-xs text-slate-400">${desc}</div>
    <div class="mt-2"><span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-indigo-300">${tag}</span></div>
  </div>`;
}

function Arrow(): HtmlEscapedString {
  return html`<span class="text-2xl text-slate-500">→</span>`;
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
        var confirmBtn = document.getElementById("kh-confirm");
        var statusEl = document.getElementById("kh-status");
        var resultEl = document.getElementById("kh-result");
        var executedEl = document.getElementById("kh-executed");
        var errorEl = document.getElementById("kh-error");
        var lastScan = null;

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
          var html = '<div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-6">'
            + '<div class="flex items-center justify-between">'
            + '<div><span class="text-3xl font-bold ' + gradeColor + '">' + s.grade + '</span><span class="ml-2 text-slate-400">Grade</span></div>'
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

        form.addEventListener("submit", async function(e) {
          e.preventDefault();
          setState("scanning");
          try {
            var res = await fetch("/api/keeperhub/scan", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: document.getElementById("kh-url").value }),
            });
            var data = await res.json();
            if (!res.ok) { setState("error", describeError(res.status, data)); return; }
            lastScan = data.scan;
            renderDryRun(data);
            setState("dry-run");
          } catch (err) { setState("error", err.message); }
        });

        confirmBtn.addEventListener("click", async function() {
          if (!lastScan) return;
          setState("executing");
          try {
            var res = await fetch("/api/keeperhub/scan", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: lastScan.url, confirm: true }),
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
      <div class="flex gap-3">
        <button type="submit" id="kh-run"
          class="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition">
          Dry-run scan
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
  return html`<section id="audit" class="border-y border-slate-700/50 bg-slate-900/30">
    <div class="mx-auto max-w-6xl px-6 py-16 sm:px-8 lg:px-12">
      <h2 class="text-2xl font-bold text-white">Live Audit Trail</h2>
      <p class="mt-2 text-slate-400">Real-time stream of onchain recordings — populated by SLICE-126-16.</p>
      <div class="mt-8 rounded-xl border border-slate-700/40 bg-slate-900/30 p-12 text-center">
        <p class="text-slate-500">Audit table loads here via SSE (EventSource)</p>
      </div>
    </div>
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
