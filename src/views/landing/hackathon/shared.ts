// EPIC-140 (SLICE-140-19): shared partials for hackathon landing pages.
// sectionWrapper + the demo/audit sections are ~98% identical between
// ai-builders and keeperhub — only a few project label strings differ.
// Those are injected via HackathonDemoConfig so rendered HTML stays identical.
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/** Project-specific strings that differ between the hackathon demo/audit sections. */
export interface HackathonDemoConfig {
  /** e.g. "Workflow executing… recording on TrustRegistry (may take up to 1 min)" */
  executingLabel: string;
  /** 503 message in demo describeError. */
  notEnabledMsg: string;
  /** 502 message in demo describeError. */
  provisioningMsg: string;
  /** 503 message in audit trail loader. */
  auditUnavailableMsg: string;
}

export function sectionWrapper(id: string, extraClass: string, content: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<section id="${id}" class="border-y border-slate-700/50 bg-slate-900/30 ${extraClass}">
    <div class="mx-auto max-w-6xl px-6 py-16 sm:px-8 lg:px-12">
      ${content}
    </div>
  </section>`;
}

export function demoSection(cfg: HackathonDemoConfig) {
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
            statusEl.innerHTML = '<div class="flex items-center gap-3 text-slate-300"><svg class="animate-spin h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span>${cfg.executingLabel}</span></div>';
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
          if (status === 503) return ${JSON.stringify(cfg.notEnabledMsg)};
          if (status === 403) return "Private or blocked URL (SSRF guard)";
          if (status === 400) return "Validation error: " + (data && data.error ? data.error : "bad request");
          if (status === 502) return ${JSON.stringify(cfg.provisioningMsg)};
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

export function auditSectionAnchor(cfg: HackathonDemoConfig) {
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
              showError(${JSON.stringify(cfg.auditUnavailableMsg)});
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
