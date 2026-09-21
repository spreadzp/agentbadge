import { html } from "hono/html";
import type { MarketTask } from "../../server/lib/market-task.js";

export interface VerificationResult {
  overallStatus: "pending" | "passed" | "failed" | "retrying";
  attempts: number;
  maxAttempts: number;
  assertions: { name: string; status: "pass" | "fail" | "pending"; detail?: string }[];
  termsFound: string[];
  termsMissing: string[];
  reportText?: string;
}

export function VerificationPanel(task: MarketTask): ReturnType<typeof html> | string {
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
