import { html } from "hono/html";

export function WorkflowSection() {
  return html`<!-- Workflow Overview -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">Workflow</h2>
      <div class="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div class="flex items-center gap-2 text-sm text-slate-300 min-w-max">
          <span class="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-emerald-300">1. Generate Data</span>
          <svg class="h-4 w-4 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span class="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-emerald-300">2. Post Task</span>
          <svg class="h-4 w-4 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span class="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-1.5 text-blue-300">3. Provider Claims</span>
          <svg class="h-4 w-4 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span class="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-1.5 text-blue-300">4. Analyze</span>
          <svg class="h-4 w-4 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span class="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-1.5 text-blue-300">5. Deliver Report</span>
          <svg class="h-4 w-4 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span class="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-emerald-300">6. Settle Payment</span>
        </div>
      </div>
    </section>`;
}

export function AgentsSection() {
  return html`<!-- Agents -->
    <section class="mt-8 grid gap-4 sm:grid-cols-2">
      <div class="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
        <div class="flex items-center gap-2">
          <span class="text-2xl">🏥</span>
          <h3 class="text-lg font-semibold text-white">Consumer Agent</h3>
        </div>
        <p class="mt-2 text-sm text-slate-300">
          Healthcare Clinic — generates medical data and posts analysis tasks.
        </p>
        <div class="mt-3 space-y-1 text-xs text-slate-400">
          <p><span class="text-emerald-400">Capability:</span> <code>medical-consumer</code></p>
          <p><span class="text-emerald-400">DID:</span> <code>did:hcs:0.0.0:3</code></p>
          <p><span class="text-emerald-400">Role:</span> Posts task, receives report, pays provider</p>
        </div>
      </div>
      <div class="rounded-lg border border-blue-500/30 bg-blue-500/5 p-5">
        <div class="flex items-center gap-2">
          <span class="text-2xl">🔬</span>
          <h3 class="text-lg font-semibold text-white">Provider Agent</h3>
        </div>
        <p class="mt-2 text-sm text-slate-300">
          Medical Data Analyst — discovers, claims, and processes medical data into reports.
        </p>
        <div class="mt-3 space-y-1 text-xs text-slate-400">
          <p><span class="text-blue-400">Capability:</span> <code>medical-analysis</code></p>
          <p><span class="text-blue-400">DID:</span> <code>did:hcs:0.0.0:2</code></p>
          <p><span class="text-blue-400">Role:</span> Claims task, analyzes data, delivers HTML report</p>
        </div>
      </div>
    </section>`;
}

export function LiveDemoSection() {
  return html`<!-- Live Marketplace Demo -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">Live Marketplace Demo</h2>
      <p class="mt-1 text-sm text-slate-400">Run the full agent-to-agent workflow — create a task, provider processes it, see the result. No HBAR spent — demo mode.</p>

      <div class="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <!-- Step buttons -->
        <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            id="demo-step-1"
            hx-post="/api/demo/consumer/register"
            hx-target="#demo-status"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold">1</span>
            Register Consumer
          </button>
          <button
            id="demo-step-2"
            hx-post="/api/demo/provider/register"
            hx-target="#demo-status"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-blue-700 text-xs font-bold">2</span>
            Register Provider
          </button>
          <button
            id="demo-step-3"
            hx-post="/api/demo/marketplace/seed"
            hx-target="#demo-status"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 transition-colors"
          >
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-amber-700 text-xs font-bold">3</span>
            Post Task
          </button>
          <button
            id="demo-step-4"
            hx-post="/api/demo/provider/run-workflow/__TASK_ID__"
            hx-target="#demo-status"
            hx-swap="innerHTML"
            hx-vals='{"medicalData": null}'
            class="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 transition-colors"
            disabled
          >
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-purple-700 text-xs font-bold">4</span>
            Provider: Claim + Analyze + Deliver
          </button>
          <button
            id="demo-step-5"
            hx-post="/api/demo/consumer/settle-payment/__TASK_ID__"
            hx-target="#demo-status"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-500 transition-colors"
            disabled
          >
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs font-bold">5</span>
            Settle Payment
          </button>
        </div>

        <!-- One-click full workflow -->
        <div class="mt-4 pt-4 border-t border-slate-800">
          <button
            id="demo-full"
            onclick="runFullDemo()"
            class="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-blue-500 px-5 py-2.5 text-sm font-semibold text-white hover:from-emerald-400 hover:to-blue-400 transition-colors"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Run Full Workflow (1 click)
          </button>
        </div>

        <!-- Status output -->
        <div id="demo-status" class="mt-4 rounded-lg bg-slate-950 p-4 min-h-[60px]">
          <p class="text-sm text-slate-500">Click "Run Full Workflow" to create a task, have a provider agent process it, and see the result.</p>
        </div>

        <!-- Task result area -->
        <div id="demo-task-result" class="mt-4"></div>
      </div>
    </section>`;
}

export function QuickGenerateSection() {
  return html`<!-- Quick generate buttons -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">Quick Generate</h2>
      <p class="mt-1 text-sm text-slate-400">Generate medical data and reports without the marketplace.</p>

      <div class="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            hx-post="/api/demo/medical-data/generate-and-process"
            hx-target="#demo-output"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Generate & Analyze
          </button>
          <button
            hx-post="/api/demo/medical-data/generate-and-report"
            hx-target="#demo-report"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Generate HTML Report
          </button>
        </div>

        <div id="demo-output" class="mt-4">
          <p class="text-sm text-slate-500">Click "Generate & Analyze" to see medical data and risk assessment.</p>
        </div>

        <div id="demo-report" class="mt-4">
          <p class="text-sm text-slate-500">Click "Generate HTML Report" to see the full medical report.</p>
        </div>
      </div>
    </section>`;
}

export function PimaSection() {
  return html`<!-- Pima Dataset Analysis (SLICE-26-8) -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">Pima Indians Diabetes — Dataset Analysis</h2>
      <p class="mt-1 text-sm text-slate-400">Generate a synthetic Pima dataset, run descriptive stats, correlation analysis, and risk factor scoring — then render a full HTML report with inline SVG charts.</p>

      <div class="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            hx-post="/api/demo/analysis/generate-report?rows=200"
            hx-target="#pima-report"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-500 transition-colors"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            Generate Analysis Report (200 rows)
          </button>
          <button
            hx-post="/api/demo/analysis/sample-report"
            hx-target="#pima-report"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Sample Report (15 rows)
          </button>
          <button
            hx-get="/api/demo/analysis/report-json?rows=200"
            hx-target="#pima-json"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-600 transition-colors"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
            View JSON Analysis
          </button>
          <button
            hx-get="/api/demo/analysis/json-report-sample"
            hx-target="#pima-json-report"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Structured JSON Report (SLICE-26-9)
          </button>
          <button
            hx-post="/api/demo/analysis/upload-ipfs"
            hx-target="#pima-ipfs"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-500 transition-colors"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            Upload to IPFS (SLICE-26-10)
          </button>
        </div>

        <div id="pima-report" class="mt-4">
          <p class="text-sm text-slate-500">Click "Generate Analysis Report" to run the full pipeline: descriptive stats → correlation matrix → risk factors → HTML report with SVG charts.</p>
        </div>
        <div id="pima-json" class="mt-4"></div>
        <div id="pima-json-report" class="mt-4"></div>
        <div id="pima-ipfs" class="mt-4"></div>
      </div>
    </section>`;
}
