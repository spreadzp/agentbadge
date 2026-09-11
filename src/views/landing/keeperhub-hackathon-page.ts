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

        <rect class="node-rect" x="10" y="40" width="140" height="60" stroke="rgb(99 102 241)" />
        <text class="node-label" x="80" y="62">Site URL</text>
        <text class="node-desc" x="80" y="78">https://example.com</text>
        <text class="node-tag" x="80" y="92">web2</text>

        <line class="flow-line" x1="155" y1="70" x2="195" y2="70" stroke="rgb(99 102 241)" stroke-width="2" marker-end="url(#arrow-indigo)" />

        <rect class="node-rect" x="200" y="40" width="160" height="60" stroke="rgb(34 197 94)" />
        <text class="node-label" x="280" y="62">AgentBadge Scan</text>
        <text class="node-desc" x="280" y="78">40 rules, score 0-100</text>
        <text class="node-tag" x="280" y="92">web2</text>

        <line class="flow-line" x1="365" y1="70" x2="405" y2="70" stroke="rgb(34 197 94)" stroke-width="2" marker-end="url(#arrow-emerald)" />

        <rect class="node-rect" x="410" y="40" width="160" height="60" stroke="rgb(168 85 247)" />
        <text class="node-label" x="490" y="62">KeeperHub Workflow</text>
        <text class="node-desc" x="490" y="78">webhook, write-contract</text>
        <text class="node-tag" x="490" y="92">MCP</text>

        <line class="flow-line" x1="575" y1="70" x2="615" y2="70" stroke="rgb(168 85 247)" stroke-width="2" marker-end="url(#arrow-purple)" />

        <rect class="node-rect" x="620" y="40" width="160" height="60" stroke="rgb(245 158 11)" />
        <text class="node-label" x="700" y="62">TrustRegistry</text>
        <text class="node-desc" x="700" y="78">recordScan() on Base</text>
        <text class="node-tag" x="700" y="92">EVM</text>

        <line class="flow-line" x1="700" y1="105" x2="700" y2="155" stroke="rgb(245 158 11)" stroke-width="2" marker-end="url(#arrow-amber)" />

        <rect class="node-rect" x="620" y="160" width="160" height="60" stroke="rgb(6 182 212)" />
        <text class="node-label" x="700" y="182">Audit Trail + SSE</text>
        <text class="node-desc" x="700" y="198">live feed + Basescan</text>
        <text class="node-tag" x="700" y="212">SSE</text>

        <path class="flow-line-branch" d="M 280 105 L 280 250 L 490 250 L 490 290" fill="none" stroke="rgb(99 102 241)" stroke-width="2" marker-end="url(#arrow-indigo)" />
        <text class="arrow-label" x="300" y="170">score >= 85</text>

        <rect class="node-rect" x="410" y="295" width="160" height="55" stroke="rgb(99 102 241)" />
        <text class="node-label" x="490" y="317">TrustBadge mint</text>
        <text class="node-desc" x="490" y="333">soulbound ERC-721 SBT</text>
        <text class="node-tag" x="490" y="345">ERC-721</text>
      </svg>
    </div>

    <p class="mt-6 text-center text-xs text-slate-400">Base Sepolia testnet — every arrow is one verifiable tx</p>
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
          return s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """);
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
