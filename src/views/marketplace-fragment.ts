import { html, raw } from "hono/html";
import type { CachedMarketTask, CachedA2AMessage } from "@agentgate-hedera/hedera-core";

/**
 * Detect content type of resultBody and render accordingly:
 * - HTML → iframe with srcdoc
 * - JSON → formatted <pre>
 * - Text/Markdown → <pre> with wrapping
 */
function renderResultBody(body: string): string {
  const trimmed = body.trim();

  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    (trimmed.startsWith("<") && trimmed.includes("<body"))
  ) {
    return `<div class="mt-2 rounded-lg border border-slate-700 bg-white overflow-hidden">
      <iframe srcdoc="${body.replace(/"/g, "&quot;")}" class="w-full h-[600px] border-0" sandbox="allow-same-origin" title="Delivery Result (HTML)"></iframe>
    </div>`;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return `<pre class="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-300"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`;
    } catch {
      // Not valid JSON
    }
  }

  return `<pre class="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-300 whitespace-pre-wrap">${body}</pre>`;
}

const PAGE_SIZE = 4;

function shortDid(did: string): string {
  return did.length > 16 ? `…${did.slice(-12)}` : did;
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp * 1000;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const NETWORK = process.env.HEDERA_NETWORK ?? "testnet";

function txToHashScanUrl(txId: string): string {
  const atIdx = txId.indexOf("@");
  if (atIdx === -1) {
    return `https://hashscan.io/${NETWORK}/transaction/${txId}`;
  }
  const accountId = txId.substring(0, atIdx);
  const timestamp = txId.substring(atIdx + 1);
  const tsDash = timestamp.replace(".", "-");
  return `https://hashscan.io/${NETWORK}/transaction/${accountId}-${tsDash}`;
}

function hashScanLinks(txId?: string, color: string = "emerald"): ReturnType<typeof html> | string {
  if (!txId) return html`<span class="text-xs text-slate-600 italic">pending</span>`;
  const url = txToHashScanUrl(txId);
  return html`<div class="flex items-center gap-1">
    <a
      href="${url}"
      target="_blank"
      rel="noopener"
      title="View transaction on HashScan"
      class="text-${color}-500 hover:text-${color}-400 transition-colors"
      aria-label="View on HashScan"
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
    </a>
    <button
      type="button"
      title="Copy HashScan link"
      class="text-${color}-500 hover:text-${color}-400 transition-colors cursor-pointer"
      aria-label="Copy HashScan link"
      onclick="navigator.clipboard.writeText('${url}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
    </button>
  </div>`;
}

function statusBadge(status: CachedMarketTask["status"]) {
  const colors: Record<string, string> = {
    posted: "bg-emerald-900 text-emerald-300 border-emerald-700",
    claimed: "bg-amber-900 text-amber-300 border-amber-700",
    delivered: "bg-blue-900 text-blue-300 border-blue-700",
    completed: "bg-slate-700 text-slate-300 border-slate-600",
  };
  return html`<span class="px-2 py-0.5 rounded text-xs font-medium border ${colors[status] ?? colors.completed}">${status}</span>`;
}

function TaskCard({ task }: { task: CachedMarketTask }) {
  const descPreview = task.description.length > 100
    ? `${task.description.substring(0, 100)}…`
    : task.description;

  return html`
    <div class="rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-600 transition-colors">
      <div class="flex items-start justify-between gap-2">
        <h4 class="text-sm font-semibold text-white truncate">${task.title}</h4>
        ${statusBadge(task.status)}
      </div>
      <div class="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
        <span class="font-mono text-slate-600" title="Task ID">${task.taskId}</span>
        <button
          type="button"
          title="Copy Task ID"
          class="text-slate-600 hover:text-emerald-400 transition-colors cursor-pointer"
          onclick="navigator.clipboard.writeText('${task.taskId}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
        >⧉</button>
      </div>
      <p class="mt-1 text-xs text-slate-400 line-clamp-2">${descPreview}</p>
      <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
        <span class="text-emerald-400 font-medium">${task.priceHbar} HBAR</span>
        <span>${task.capabilities.join(", ")}</span>
      </div>
      <div class="mt-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-500" title="${task.posterDid}">${shortDid(task.posterDid)}</span>
          ${hashScanLinks(task.txId)}
        </div>
        <div class="flex items-center gap-3">
          <a
            href="/ui/medical-demo/${task.taskId}"
            class="text-xs text-emerald-400 hover:text-emerald-300"
            title="Medical Demo for this task"
          >Demo</a>
          <a
            href="/ui/market/tasks/${task.taskId}"
            class="text-xs text-blue-400 hover:text-blue-300"
          >View Details</a>
        </div>
      </div>
    </div>
  `;
}

export function MarketplaceTaskBoardFragment(tasks: CachedMarketTask[]) {
  if (tasks.length === 0) {
    return html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-300">
      <p>No tasks available.</p>
      <p class="text-sm mt-2 text-slate-400">Posted marketplace tasks will appear here automatically.</p>
    </div>`;
  }

  const visible = tasks.slice(0, PAGE_SIZE);
  const hidden = tasks.slice(PAGE_SIZE);

  return html`<div class="space-y-3"
    ><div class="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >${visible.map((task) => TaskCard({ task }))}${hidden.map(
    (task) =>
      html`<div class="hidden" data-paginated="true">${TaskCard({ task })}</div>`,
  )}</div
    >${hidden.length > 0
      ? html`<button
        type="button"
        onclick="showMore(this, ${PAGE_SIZE})"
        class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
      >
        Show more (<span class="show-more-remaining">${hidden.length}</span> remaining)
      </button>`
      : ""}</div
  >`;
}

function escrowStatusBadge(status: string): ReturnType<typeof html> {
  const colors: Record<string, string> = {
    none: "bg-slate-700 text-slate-400 border-slate-600",
    pending: "bg-amber-900 text-amber-300 border-amber-700",
    released: "bg-emerald-900 text-emerald-300 border-emerald-700",
    cancelled: "bg-red-900 text-red-300 border-red-700",
    expired: "bg-red-900 text-red-300 border-red-700",
  };
  const color = colors[status] ?? colors.none;
  const label = status === "none" ? "no escrow" : status;
  return html`<span class="px-2 py-0.5 rounded text-xs font-medium border ${color}">${label}</span>`;
}

export function EscrowPanel(task: CachedMarketTask, viewerDid?: string): ReturnType<typeof html> | string {
  const escrowStatus = task.escrowStatus ?? "none";
  const scheduleId = task.scheduleId;
  const isPoster = viewerDid === task.posterDid;
  const hashscanUrl = scheduleId
    ? `https://hashscan.io/testnet/transaction/${scheduleId}`
    : null;

  // Only show panel if there's an escrow or schedule
  if (escrowStatus === "none" && !scheduleId) return "";

  const pollUrl = `/ui/market/tasks/${task.taskId}/escrow-fragment${viewerDid ? `?did=${encodeURIComponent(viewerDid)}` : ""}`;

  return html`<div
    class="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3"
    hx-get="${pollUrl}"
    hx-trigger="every 5s"
    hx-swap="outerHTML"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <svg class="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 0012-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        <h3 class="text-sm font-semibold text-white">Escrow Status</h3>
      </div>
      ${escrowStatusBadge(escrowStatus)}
    </div>
    <div class="grid grid-cols-2 gap-3 text-xs">
      <div>
        <span class="text-slate-500">Scheduled TX:</span>
        <div class="mt-0.5 font-mono text-slate-300 truncate" title="${scheduleId ?? "—"}">${scheduleId ?? "—"}</div>
      </div>
      <div>
        <span class="text-slate-500">Amount:</span>
        <div class="mt-0.5 text-emerald-400 font-medium">${task.priceHbar} HBAR</div>
      </div>
      ${hashscanUrl
      ? html`<div class="col-span-2">
            <a href="${hashscanUrl}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              View on HashScan
            </a>
          </div>`
      : ""}
    </div>
    ${isPoster && escrowStatus === "pending" && task.status === "delivered"
      ? html`<div class="flex items-center gap-2 pt-2 border-t border-slate-800">
            <button
              class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium"
              hx-post="/market/tasks/${task.taskId}/complete"
              hx-swap="outerHTML"
            >
              Sign & Release
            </button>
            <button
              class="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded-lg text-xs font-medium"
              hx-post="/market/tasks/${task.taskId}/cancel"
              hx-swap="outerHTML"
            >
              Cancel & Refund
            </button>
          </div>`
      : ""}
    ${isPoster && escrowStatus === "pending" && task.status === "posted"
      ? html`<div class="flex items-center gap-2 pt-2 border-t border-slate-800">
            <button
              class="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded-lg text-xs font-medium"
              hx-post="/market/tasks/${task.taskId}/cancel"
              hx-swap="outerHTML"
            >
              Cancel & Refund
            </button>
          </div>`
      : ""}
  </div>`;
}

export interface VerificationResult {
  overallStatus: "pending" | "passed" | "failed" | "retrying";
  attempts: number;
  maxAttempts: number;
  assertions: { name: string; status: "pass" | "fail" | "pending"; detail?: string }[];
  termsFound: string[];
  termsMissing: string[];
  reportText?: string;
}

export function VerificationPanel(task: CachedMarketTask): ReturnType<typeof html> | string {
  const attempts = task.verificationAttempts ?? 0;
  const report = task.verificationReport;
  const verifierType = task.verifierType ?? "noop";

  // Only show panel if there are verification attempts or a report
  if (attempts === 0 && !report && verifierType === "noop") return "";

  // Determine overall status from task status and attempts
  let overallStatus: VerificationResult["overallStatus"] = "pending";
  if (task.status === "completed") {
    overallStatus = "passed";
  } else if (task.status === "delivered" && attempts > 0) {
    overallStatus = attempts >= 3 ? "failed" : "retrying";
  }

  const statusColors: Record<string, string> = {
    pending: "bg-slate-700 text-slate-400 border-slate-600",
    passed: "bg-emerald-900 text-emerald-300 border-emerald-700",
    failed: "bg-red-900 text-red-300 border-red-700",
    retrying: "bg-amber-900 text-amber-300 border-amber-700",
  };
  const statusColor = statusColors[overallStatus] ?? statusColors.pending;

  // Parse report text for assertions and glossary terms if available
  let assertions: VerificationResult["assertions"] = [];
  let termsFound: string[] = [];
  let termsMissing: string[] = [];

  if (report) {
    try {
      const parsed = JSON.parse(report);
      if (parsed.assertions && Array.isArray(parsed.assertions)) {
        assertions = parsed.assertions.map((a: { name?: string; assertion?: string; passed?: boolean; detail?: string; message?: string }) => ({
          name: a.name ?? a.assertion ?? "unknown",
          status: a.passed ? "pass" : "fail",
          detail: a.detail ?? a.message,
        }));
      }
      if (parsed.termsFound && Array.isArray(parsed.termsFound)) {
        termsFound = parsed.termsFound;
      }
      if (parsed.termsMissing && Array.isArray(parsed.termsMissing)) {
        termsMissing = parsed.termsMissing;
      }
    } catch {
      // Report is plain text, not JSON
    }
  }

  return html`<div class="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <svg class="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <h3 class="text-sm font-semibold text-white">DataHub Verification</h3>
      </div>
      <span class="px-2 py-0.5 rounded text-xs font-medium border ${statusColor}">${overallStatus}</span>
    </div>
    <div class="flex items-center gap-3 text-xs">
      <span class="text-slate-500">Attempts:</span>
      <span class="font-mono text-slate-300">${attempts}/3</span>
      <span class="text-slate-500">Verifier:</span>
      <span class="font-mono text-slate-300">${verifierType}</span>
    </div>
    ${assertions.length > 0
      ? html`<div class="space-y-1.5">
            <p class="text-xs text-slate-500 font-medium">Assertion Checks:</p>
            ${assertions.map((a) => {
        const icon = a.status === "pass" ? "✓" : a.status === "fail" ? "✗" : "⋯";
        const color = a.status === "pass" ? "text-emerald-400" : a.status === "fail" ? "text-red-400" : "text-slate-400";
        return html`<div class="flex items-start gap-2 text-xs">
                <span class="${color} font-bold">${icon}</span>
                <div class="flex-1">
                  <span class="text-slate-300">${a.name}</span>
                  ${a.detail ? html`<span class="text-slate-500"> — ${a.detail}</span>` : ""}
                </div>
              </div>`;
      })}
          </div>`
      : ""}
    ${termsFound.length > 0 || termsMissing.length > 0
      ? html`<div class="space-y-1.5">
            <p class="text-xs text-slate-500 font-medium">Glossary Terms:</p>
            <div class="flex flex-wrap gap-1.5">
              ${termsFound.map((t) => html`<span class="px-2 py-0.5 rounded text-xs bg-emerald-900 text-emerald-300 border border-emerald-700">${t}</span>`)}
              ${termsMissing.map((t) => html`<span class="px-2 py-0.5 rounded text-xs bg-red-900 text-red-300 border border-red-700">${t}</span>`)}
            </div>
          </div>`
      : ""}
    ${report && !assertions.length
      ? html`<div class="rounded bg-slate-950 p-2 text-xs text-slate-400 overflow-x-auto">
            <pre class="whitespace-pre-wrap">${report.slice(0, 500)}</pre>
          </div>`
      : ""}
  </div>`;
}

export function DataHubLinks(datasetUrn?: string): ReturnType<typeof html> | string {
  if (!datasetUrn) return "";

  const datahubUrl = process.env.DATAHUB_UI_URL ?? "http://localhost:9002";
  const encodedUrn = encodeURIComponent(datasetUrn);

  return html`<div class="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-2">
    <div class="flex items-center gap-2">
      <svg class="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
      <h3 class="text-sm font-semibold text-white">DataHub Catalog</h3>
    </div>
    <div class="text-xs text-slate-500">Dataset URN:</div>
    <div class="font-mono text-xs text-slate-300 break-all">${datasetUrn}</div>
    <div class="flex flex-wrap gap-2 pt-1">
      <a href="${datahubUrl}/dataset/${encodedUrn}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 transition-colors">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        View Dataset
      </a>
      <a href="${datahubUrl}/lineage/${encodedUrn}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 transition-colors">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
        Lineage Graph
      </a>
      <a href="${datahubUrl}/glossary" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 transition-colors">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.029 4.988 7.529 4.231 5 4.231c-2.53 0-5.029.757-7 2.022v13c1.971-1.265 4.471-2.022 7-2.022 2.529 0 5.029.757 7 2.022V4.231c1.971-1.265 4.471-2.022 7-2.022 2.529 0 5.029.757 7 2.022v13c-1.971-1.265-4.471-2.022-7-2.022-2.529 0-5.029.757-7 2.022" /></svg>
        Glossary
      </a>
      <a href="${datahubUrl}/assertions" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700 transition-colors">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        Assertions
      </a>
    </div>
  </div>`;
}

export function TaskDetailsFragment(
  task: CachedMarketTask,
  viewerDid?: string,
  messages: CachedA2AMessage[] = [],
) {
  return html`
    <div class="max-w-2xl mx-auto space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-white">${task.title}</h2>
        ${statusBadge(task.status)}
      </div>
      <p class="text-slate-300">${task.description}</p>
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span class="text-slate-500">Task ID:</span>
          <span class="font-mono text-slate-300 text-xs">${task.taskId}</span>
        </div>
        <div>
          <span class="text-slate-500">Price:</span>
          <span class="text-emerald-400 font-medium">${task.priceHbar} HBAR</span>
        </div>
        <div>
          <span class="text-slate-500">Posted by:</span>
          <span class="text-slate-300" title="${task.posterDid}">${shortDid(task.posterDid)}</span>
        </div>
        <div>
          <span class="text-slate-500">Capabilities:</span>
          <span class="text-slate-300">${task.capabilities.join(", ")}</span>
        </div>
        <div>
          <span class="text-slate-500">Created:</span>
          <span class="text-slate-300">${relativeTime(task.createdAt)}</span>
        </div>
        ${task.deadline
      ? html`<div>
              <span class="text-slate-500">Deadline:</span>
              <span class="text-slate-300">${relativeTime(task.deadline)}</span>
            </div>`
      : ""}
        ${task.claimerDid
      ? html`<div>
              <span class="text-slate-500">Claimed by:</span>
              <span class="text-slate-300" title="${task.claimerDid}">${shortDid(task.claimerDid)}</span>
            </div>`
      : ""}
      </div>
      <div class="flex flex-wrap items-center gap-4 pt-2">
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
          <span class="text-xs text-slate-500">Post TX:</span>
          ${hashScanLinks(task.txId, "emerald")}
        </div>
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" transform="rotate(180 12 12)" /><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l3 3 3-3" /></svg>
          <span class="text-xs text-slate-500">Claim TX:</span>
          ${hashScanLinks(task.claimTxId, "amber")}
        </div>
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
          <span class="text-xs text-slate-500">Deliver TX:</span>
          ${hashScanLinks(task.deliverTxId, "blue")}
        </div>
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-violet-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span class="text-xs text-slate-500">Payment TX:</span>
          ${hashScanLinks(task.paymentTxId, "violet")}
        </div>
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-teal-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
          <span class="text-xs text-slate-500">Completed TX:</span>
          ${hashScanLinks(task.completedTxId, "teal")}
        </div>
      </div>
      ${EscrowPanel(task, viewerDid)}
      ${VerificationPanel(task)}
      ${DataHubLinks((task as CachedMarketTask & { datasetUrn?: string }).datasetUrn)}
      <div class="pt-2">
        <a
          href="/ui/medical-demo/${task.taskId}"
          class="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
          Open Medical Demo for this task
        </a>
      </div>
      ${task.status === "posted"
      ? html`<div class="pt-4">
            <button
              class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium"
              hx-post="/market/tasks/${task.taskId}/claim"
              hx-swap="outerHTML"
            >
              Claim Task
            </button>
          </div>`
      : ""}
      ${task.resultBody
      ? html`<div class="pt-4 border-t border-slate-800">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-semibold text-white">Delivery Result</h3>
              <a
                href="/ui/market/tasks/${task.taskId}/result"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
              >
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                Open in new tab
              </a>
            </div>
            ${raw(renderResultBody(task.resultBody))}
          </div>`
      : ""}
      ${task.resultIpfs
      ? html`<div class="pt-2 text-xs text-slate-400">
            Full report (IPFS): <a href="${task.resultIpfs}" target="_blank" rel="noopener" class="text-blue-400 hover:underline break-all">${task.resultIpfs}</a>
          </div>`
      : ""}
      ${viewerDid
      ? html`<div class="pt-4 border-t border-slate-800">
            ${TaskMessagesFragment(task, messages, viewerDid)}
          </div>`
      : html`<div class="pt-4 border-t border-slate-800">
            <div class="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
              <div class="flex items-center gap-3">
                <svg class="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z" /></svg>
                <div class="flex-1">
                  <p class="text-sm text-slate-300">Task Messages</p>
                  <p class="text-xs text-slate-500">Enter your DID to view and send messages.</p>
                </div>
              </div>
              <form
                hx-get="/ui/market/tasks/${task.taskId}/fragment"
                hx-target="closest div.htmx-poll-wrapper"
                hx-swap="outerHTML"
                class="flex items-center gap-2"
              >
                <input
                  type="text"
                  name="did"
                  placeholder="did:hcs:0.0.xxxx:n"
                  class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
                >
                  Load Messages
                </button>
              </form>
              <div class="flex items-center gap-2">
                <a
                  href="/ui/a2a/inbox?did=${encodeURIComponent(task.posterDid)}"
                  class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 009.586 13H7" /></svg>
                  Inbox
                </a>
                <a
                  href="/ui/a2a/outbox?did=${encodeURIComponent(task.posterDid)}"
                  class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  Outbox
                </a>
              </div>
            </div>
          </div>`}
    </div>
  `;
}

export function TaskMessagesFragment(
  task: CachedMarketTask,
  messages: CachedA2AMessage[],
  viewerDid: string,
) {
  const otherDid = viewerDid === task.posterDid
    ? (task.claimerDid ?? task.posterDid)
    : task.posterDid;
  const otherRole = viewerDid === task.posterDid ? "task claimer" : "task poster";
  const encodedViewer = encodeURIComponent(viewerDid);
  const encodedOther = encodeURIComponent(otherDid);

  const inbox = messages.filter((m) => m.to === viewerDid);
  const outbox = messages.filter((m) => m.from === viewerDid);

  return html`
    <div id="task-messages" class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <svg class="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z" /></svg>
          <h3 class="text-sm font-semibold text-white">Task Messages</h3>
          ${messages.length > 0
      ? html`<span class="rounded-full bg-emerald-900 text-emerald-300 text-xs px-2 py-0.5">${messages.length}</span>`
      : ""}
        </div>
        <div class="flex items-center gap-2">
          <a
            href="/ui/a2a/inbox?did=${encodedViewer}"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
            title="View full inbox"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 009.586 13H7" /></svg>
            Inbox
          </a>
          <a
            href="/ui/a2a/outbox?did=${encodedViewer}"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
            title="View full outbox"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            Outbox
          </a>
        </div>
      </div>

      <div class="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
          <span class="font-mono text-emerald-400" title="${viewerDid}">${shortDid(viewerDid)}</span>
          <svg class="h-3 w-3 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
          <span class="font-mono text-sky-400" title="${otherDid}">${shortDid(otherDid)}</span>
          <span class="text-slate-600">(${otherRole})</span>
        </div>

        ${messages.length === 0
      ? html`<p class="text-sm text-slate-400 py-2">No messages yet. Ask a question below.</p>`
      : html`<div class="space-y-3 max-h-64 overflow-y-auto">
              ${inbox.length > 0
          ? html`<div>
                    <div class="text-xs font-semibold text-slate-400 mb-1">Inbox (${inbox.length})</div>
                    ${inbox.map((msg) => html`<div class="flex justify-start mb-1.5">
                      <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200">
                        <p>${msg.body}</p>
                        <div class="flex items-center gap-1.5 mt-0.5">
                          <span class="text-xs text-slate-500">${relativeTime(msg.timestamp)}</span>
                          ${hashScanLinks(msg.txId, "slate")}
                        </div>
                      </div>
                    </div>`)}
                  </div>`
          : ""}
              ${outbox.length > 0
          ? html`<div>
                    <div class="text-xs font-semibold text-slate-400 mb-1">Outbox (${outbox.length})</div>
                    ${outbox.map((msg) => html`<div class="flex justify-end mb-1.5">
                      <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-emerald-900 text-emerald-50">
                        <p>${msg.body}</p>
                        <div class="flex items-center gap-1.5 mt-0.5">
                          <span class="text-xs text-emerald-400">${relativeTime(msg.timestamp)}</span>
                          ${hashScanLinks(msg.txId, "emerald")}
                        </div>
                      </div>
                    </div>`)}
                  </div>`
          : ""}
            </div>`}
      </div>

      <form
        hx-post="/ui/market/tasks/${task.taskId}/send-message"
        hx-target="#task-messages"
        hx-swap="outerHTML"
        class="space-y-2"
      >
        <input type="hidden" name="from" value="${viewerDid}" />
        <input type="hidden" name="to" value="${otherDid}" />
        <div class="grid grid-cols-2 gap-2">
          <input
            type="text"
            name="fromAccountId"
            placeholder="Account ID (0.0.xxxx)"
            required
            class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <input
            type="password"
            name="privateKey"
            placeholder="Private key (hex)"
            required
            class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div class="flex gap-2">
          <input
            type="text"
            name="body"
            placeholder="Type a message to the task poster…"
            maxlength="4000"
            required
            class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            type="submit"
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  `;
}
