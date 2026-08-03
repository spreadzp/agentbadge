import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { PageHeader } from "./page-header";
import { PageMeta } from "../server/lib/page-meta";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

/**
 * Detect content type of resultBody and render accordingly:
 * - HTML (starts with <!DOCTYPE or <html) → render as raw HTML in an iframe container
 * - JSON (starts with { or [) → formatted <pre> block
 * - Text/Markdown → <pre> block with whitespace preserved
 */
function renderResultBody(body: string): string {
  const trimmed = body.trim();

  // HTML detection
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    (trimmed.startsWith("<") && trimmed.includes("<body"))
  ) {
    return `<div class="mt-2 rounded-lg border border-slate-700 bg-white overflow-hidden">
      <iframe srcdoc="${body.replace(/"/g, "&quot;")}" class="w-full h-[600px] border-0" sandbox="allow-same-origin" title="Delivery Result (HTML)"></iframe>
    </div>`;
  }

  // JSON detection
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return `<pre class="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-300"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`;
    } catch {
      // Not valid JSON, fall through to text
    }
  }

  // Plain text / Markdown
  return `<pre class="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-300 whitespace-pre-wrap">${body}</pre>`;
}

/**
 * Task banner — shows live marketplace task data when the demo page is opened
 * for a specific task (`/ui/medical-demo/:taskId`).
 */
function TaskBanner(task: CachedMarketTask) {
  const statusColors: Record<string, string> = {
    posted: "bg-emerald-900 text-emerald-300 border-emerald-700",
    claimed: "bg-amber-900 text-amber-300 border-amber-700",
    delivered: "bg-blue-900 text-blue-300 border-blue-700",
    completed: "bg-slate-700 text-slate-300 border-slate-600",
  };
  const color = statusColors[task.status] ?? statusColors.completed;

  return html`<section
    class="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-5"
  >
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-white truncate">${task.title}</h2>
          <span class="px-2 py-0.5 rounded text-xs font-medium border ${color}">${task.status}</span>
        </div>
        <p class="mt-1 text-sm text-slate-400 line-clamp-2">${task.description}</p>
      </div>
      <div class="shrink-0 text-right">
        <div class="text-lg font-bold text-emerald-400">${task.priceHbar} HBAR</div>
        <div class="text-xs text-slate-500">${task.capabilities.join(", ")}</div>
      </div>
    </div>
    <div class="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
      <div>
        <span class="text-slate-500">Task ID</span>
        <div class="mt-0.5 flex items-center gap-1">
          <span class="font-mono text-slate-300 truncate">${task.taskId}</span>
          <button
            type="button"
            title="Copy Task ID"
            class="text-slate-600 hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
            onclick="navigator.clipboard.writeText('${task.taskId}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
          >⧉</button>
        </div>
      </div>
      <div>
        <span class="text-slate-500">Poster DID</span>
        <div class="mt-0.5 font-mono text-slate-300 truncate" title="${task.posterDid}">${task.posterDid}</div>
      </div>
      <div>
        <span class="text-slate-500">Claimed by</span>
        <div class="mt-0.5 font-mono text-slate-300 truncate" title="${task.claimerDid ?? "—"}">${task.claimerDid ?? "—"}</div>
      </div>
      <div>
        <span class="text-slate-500">Created</span>
        <div class="mt-0.5 text-slate-300">${new Date(task.createdAt * 1000).toLocaleString()}</div>
      </div>
    </div>
    ${task.resultBody || task.resultIpfs
      ? html`<div class="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-blue-300">Delivery Result</h3>
            ${task.resultBody
          ? html`<a
                  href="/ui/market/tasks/${task.taskId}/result"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  Open in new tab
                </a>`
          : ""}
          </div>
          ${task.resultBody
          ? raw(renderResultBody(task.resultBody))
          : ""}
          ${task.resultIpfs
          ? html`<div class="mt-2">
                <p class="text-xs text-slate-400">Full report (IPFS):</p>
                <a href="${task.resultIpfs}" target="_blank" rel="noopener" class="text-sm text-blue-400 hover:underline break-all">${task.resultIpfs}</a>
              </div>`
          : ""}
        </div>`
      : ""}
    <div class="mt-3 flex items-center gap-3">
      <a
        href="/ui/market/tasks/${task.taskId}"
        class="text-xs text-blue-400 hover:text-blue-300"
      >View Task Details →</a>
      ${task.status === "posted"
      ? html`<button
            class="text-xs text-emerald-400 hover:text-emerald-300"
            hx-post="/market/tasks/${task.taskId}/claim"
            hx-swap="outerHTML"
          >Claim this task</button>`
      : ""}
    </div>
  </section>`;
}

/**
 * Medical Data Skills demo page — shows the full agent-to-agent medical data
 * processing workflow: consumer generates data → posts task → provider claims →
 * processes → delivers HTML report → consumer receives & settles payment.
 *
 * When `task` is provided, shows live task data and status.
 * Includes interactive demo buttons (HTMX) and data format reference.
 */
export function MedicalDemoPage(task?: CachedMarketTask) {
  const content = html`${raw(
    PageHeader({
      badge: "Medical Data Marketplace",
      title: "Medical Data Skills",
      description:
        "Agent-to-agent medical data processing workflow. A consumer agent generates patient data, posts a marketplace task, and a provider agent analyzes it — returning a professional HTML medical report.",
    }).toString(),
  )}

    ${task ? raw(TaskBanner(task).toString()) : ""}

    <!-- Workflow Overview -->
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
    </section>

    <!-- Agents -->
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
    </section>

    <!-- Live Marketplace Demo -->
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
    </section>

    <!-- Quick generate buttons -->
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
    </section>

    <!-- Pima Dataset Analysis (SLICE-26-8) -->
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
        </div>

        <div id="pima-report" class="mt-4">
          <p class="text-sm text-slate-500">Click "Generate Analysis Report" to run the full pipeline: descriptive stats → correlation matrix → risk factors → HTML report with SVG charts.</p>
        </div>
        <div id="pima-json" class="mt-4"></div>
      </div>
    </section>

    <!-- Data Formats -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">Data Formats</h2>
      <p class="mt-1 text-sm text-slate-400">What agents send and receive.</p>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <!-- MedicalData input -->
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 class="text-sm font-semibold text-emerald-400">MedicalData (Input)</h3>
          <p class="mt-1 text-xs text-slate-400">Consumer generates this and attaches to marketplace task.</p>
          <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300"><code>{
  "patientId": "P001",
  "patientName": "John Doe",
  "age": 45,
  "gender": "M",
  "vitalSigns": {
    "heartRate": 72,
    "bloodPressure": "120/80",
    "temperature": 37.2,
    "respiratoryRate": 16,
    "oxygenSaturation": 98
  },
  "labResults": {
    "glucose": 95,
    "cholesterol": 180,
    "hemoglobin": 14.5,
    "whiteBloodCells": 7.2,
    "platelets": 250
  },
  "symptoms": ["mild headache"],
  "medicalHistory": ["hypertension"]
}</code></pre>
        </div>

        <!-- AnalysisResult output -->
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 class="text-sm font-semibold text-blue-400">AnalysisResult (Output)</h3>
          <p class="mt-1 text-xs text-slate-400">Provider returns this after processing.</p>
          <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300"><code>{
  "riskLevel": "low",
  "abnormalFindings": [],
  "recommendations": [
    "Continue current lifestyle",
    "Regular checkups recommended"
  ],
  "vitalSignsStatus": {
    "heartRate": "normal",
    "bloodPressure": "normal",
    "temperature": "normal"
  },
  "labResultsStatus": {
    "glucose": "normal",
    "cholesterol": "normal"
  }
}</code></pre>
        </div>
      </div>
    </section>

    <!-- HTML Report Structure -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">HTML Report Structure</h2>
      <p class="mt-1 text-sm text-slate-400">The provider delivers a self-contained HTML report with:</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Patient Information</h3>
          <p class="mt-1 text-xs text-slate-400">ID, name, age, gender</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Risk Assessment</h3>
          <p class="mt-1 text-xs text-slate-400">Low / Moderate / High with summary</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Vital Signs</h3>
          <p class="mt-1 text-xs text-slate-400">Radar chart + table with normal ranges</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Lab Results</h3>
          <p class="mt-1 text-xs text-slate-400">Bar chart + table with normal ranges</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Recommendations</h3>
          <p class="mt-1 text-xs text-slate-400">Actionable clinical recommendations</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">SVG Charts</h3>
          <p class="mt-1 text-xs text-slate-400">Radar (vitals) + bar (labs) — no external deps</p>
        </div>
      </div>
    </section>

    <!-- API Endpoints -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">Demo API Endpoints</h2>
      <div class="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-800 text-left text-slate-400">
              <th class="pb-2 pr-4 font-medium">Method</th>
              <th class="pb-2 pr-4 font-medium">Endpoint</th>
              <th class="pb-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
            <tr>
              <td class="py-2 pr-4 text-emerald-400">GET</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/generate</code></td>
              <td class="py-2 text-slate-300">Generate random medical data</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-emerald-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/process</code></td>
              <td class="py-2 text-slate-300">Analyze medical data → risk + findings</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-emerald-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/report</code></td>
              <td class="py-2 text-slate-300">Generate HTML report from data + analysis</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-emerald-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/generate-and-process</code></td>
              <td class="py-2 text-slate-300">Generate + analyze in one call</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-emerald-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/generate-and-report</code></td>
              <td class="py-2 text-slate-300">Generate + analyze + HTML report in one call</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-blue-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/consumer/run-workflow</code></td>
              <td class="py-2 text-slate-300">Full consumer workflow (post → receive → settle)</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-blue-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/provider/run-workflow/:taskId</code></td>
              <td class="py-2 text-slate-300">Full provider workflow (claim → process → deliver)</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-blue-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/marketplace/seed</code></td>
              <td class="py-2 text-slate-300">Seed a demo marketplace task</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Passport Requirements -->
    <section class="mt-8 rounded-lg border border-purple-500/30 bg-purple-500/5 p-6">
      <h2 class="text-lg font-semibold text-white">Passport Requirements</h2>
      <p class="mt-2 text-sm text-slate-300">
        Both agents need an AgentGate passport NFT with specific capabilities:
      </p>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-semibold text-emerald-400">Consumer Agent</h3>
          <ul class="mt-2 space-y-1 text-xs text-slate-400">
            <li><span class="text-slate-300">Tier:</span> Bronze+ (any)</li>
            <li><span class="text-slate-300">Capabilities:</span> <code>medical-consumer</code>, <code>marketplace</code></li>
            <li><span class="text-slate-300">Skills:</span> <code>data_generation</code>, <code>payment</code></li>
            <li><span class="text-slate-300">Endpoint:</span> Consumer profile page</li>
          </ul>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-semibold text-blue-400">Provider Agent</h3>
          <ul class="mt-2 space-y-1 text-xs text-slate-400">
            <li><span class="text-slate-300">Tier:</span> Silver+ (for marketplace capability)</li>
            <li><span class="text-slate-300">Capabilities:</span> <code>medical-analysis</code>, <code>marketplace</code></li>
            <li><span class="text-slate-300">Skills:</span> <code>data_analysis</code>, <code>medical_processing</code></li>
            <li><span class="text-slate-300">Endpoint:</span> Provider profile page</li>
          </ul>
        </div>
      </div>
      <p class="mt-3 text-xs text-slate-400">
        See <a href="/agent-guide" class="text-emerald-400 underline hover:text-emerald-300">Agent Guide</a> for passport setup instructions.
      </p>
    </section>

    <!-- CLI Demo -->
    <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-lg font-semibold text-white">CLI Demo</h2>
      <p class="mt-2 text-sm text-slate-300">Run the full E2E workflow from terminal:</p>
      <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300"><code>bun run demo:medical-marketplace</code></pre>
      <p class="mt-2 text-xs text-slate-400">
        Runs: register → generate data → post task → claim → process → deliver → receive → settle payment.
      </p>
    </section>

    <script>
      async function runFullDemo() {
        const status = document.getElementById('demo-status');
        const result = document.getElementById('demo-task-result');
        const btn = document.getElementById('demo-full');
        btn.disabled = true;
        btn.textContent = 'Running...';
        status.innerHTML = '<p class="text-sm text-slate-400">Step 1/5: Registering consumer agent...</p>';

        try {
          // Step 1: Register consumer
          await fetch('/api/demo/consumer/register', { method: 'POST' });
          status.innerHTML = '<p class="text-sm text-slate-400">Step 2/5: Registering provider agent...</p>';

          // Step 2: Register provider
          await fetch('/api/demo/provider/register', { method: 'POST' });
          status.innerHTML = '<p class="text-sm text-slate-400">Step 3/5: Posting task to marketplace...</p>';

          // Step 3: Seed task
          const seedRes = await fetch('/api/demo/marketplace/seed', { method: 'POST' });
          const seedData = await seedRes.json();
          const taskId = seedData.taskId;
          status.innerHTML = '<p class="text-sm text-emerald-400">Step 3: Task created: ' + taskId + '</p><p class="text-sm text-slate-400">Step 4/5: Provider claiming, analyzing, delivering...</p>';

          // Step 4: Provider runs full workflow
          const provRes = await fetch('/api/demo/provider/run-workflow/' + taskId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          const provData = await provRes.json();
          status.innerHTML = '<p class="text-sm text-emerald-400">Step 4: Provider delivered! Risk: ' + provData.analysis.riskLevel + ', Report: ' + provData.reportLength + 'b</p><p class="text-sm text-slate-400">Step 5/5: Settling payment...</p>';

          // Step 5: Settle payment
          await fetch('/api/demo/consumer/settle-payment/' + taskId, { method: 'POST' });

          // Final: Show task link + result
          status.innerHTML = '<p class="text-sm text-emerald-400">✅ Workflow complete! Task: ' + taskId + '</p>';
          result.innerHTML = '<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">'
            + '<h3 class="text-sm font-semibold text-white">Task Created & Completed</h3>'
            + '<div class="mt-2 flex flex-wrap gap-3">'
            + '<a href="/ui/market/tasks/' + taskId + '" class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">📋 View Task Details</a>'
            + '<a href="/ui/medical-demo/' + taskId + '" class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">🏥 Medical Demo</a>'
            + '<a href="/ui/market/tasks/' + taskId + '/result" target="_blank" class="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">📄 Open Report</a>'
            + '</div></div>';
        } catch (err) {
          status.innerHTML = '<p class="text-sm text-red-400">Error: ' + err.message + '</p>';
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> Run Full Workflow (1 click)';
        }
      }
    </script>`;

  return Layout(content.toString(), "Medical Data Demo", PageMeta["/ui/medical-demo"]);
}
