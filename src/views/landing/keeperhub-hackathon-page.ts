import { html, raw } from "hono/html";

/**
 * KeeperHubHackathonPage — interactive demo form for scan → onchain record.
 *
 * Phase D (SLICE-126-14): demo form with dry-run preview + confirm flow.
 * Full landing page (hero, architecture, copy) lands in SLICE-126-15.
 * Live audit table lands in SLICE-126-16.
 */
export function KeeperHubHackathonPage() {
  const sections = [
    KeeperHubHero().toString(),
    KeeperHubDemo().toString(),
  ];

  return html`<div>${raw(sections.join(""))}</div>`;
}

function KeeperHubHero() {
  return html`<section class="relative overflow-hidden border-b border-slate-700/50 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-indigo-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          KeeperHub <span class="text-indigo-400">×</span> AgentBadge
        </h1>
        <p class="mt-6 text-lg text-slate-300 sm:text-xl">
          Onchain trust layer for agent readiness — powered by KeeperHub deterministic execution.
        </p>
        <p class="mt-4 text-sm text-slate-400">
          Scan any website, record the trust score on TrustRegistry (Base Sepolia), and mint a soulbound TrustBadge. KeeperHub Agent Economy hackathon (Sep 6–18, 2026).
        </p>
      </div>
    </div>
  </section>`;
}

function KeeperHubDemo() {
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
