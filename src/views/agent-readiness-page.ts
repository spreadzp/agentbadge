/**
 * SLICE-201-15: /agent-readiness — dogfooding showcase page.
 * Explains the Agent-Native approach and shows a live self-scan:
 * our own scanner run against BASE_URL, cached (D-201-22).
 * Honest wording only: what was checked, what wasn't — no marketing claims.
 */
import { html } from "hono/html";
import type { ScanReport } from "../agent-readiness/report-formatter";

export interface SelfScanState {
  status: "ok" | "unavailable" | "pending";
  report: ScanReport | null;
  scannedAt: string | null;
  error?: string;
}

const STATUS_STYLE: Record<string, string> = {
  VERIFIED: "text-emerald-400",
  INFERRED: "text-emerald-300",
  GAP: "text-rose-400",
  NOT_APPLICABLE: "text-slate-500",
  SKIPPED: "text-slate-500",
};

function ScanSection(state: SelfScanState, target: string) {
  if (state.status === "unavailable") {
    return html`<section
      class="rounded-xl border border-slate-700 bg-slate-900/50 p-6"
      aria-label="Self-scan"
    >
      <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500">Self-scan</h2>
      <p class="mt-2 text-sm text-slate-400">
        Live scan of <code class="text-emerald-400">${target}</code> is temporarily
        unavailable${state.error ? html` (${state.error})` : ""}. The page still works — reload to
        retry.
      </p>
    </section>`;
  }
  const report = state.report;
  if (!report) {
    return html`<section
      class="rounded-xl border border-slate-700 bg-slate-900/50 p-6"
      aria-label="Self-scan"
    >
      <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500">Self-scan</h2>
      <p class="mt-2 text-sm text-slate-400">Scan of ${target} is running — reload in a moment.</p>
    </section>`;
  }
  return html`<section
    class="rounded-xl border border-slate-700 bg-slate-900/50 p-6"
    aria-label="Self-scan"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500">
        Self-scan — our scanner on our own site
      </h2>
      <div class="text-xs text-slate-500">
        scanned ${state.scannedAt ?? "—"} ·
        <a href="?refresh=1" class="text-emerald-400 hover:text-emerald-300">refresh ↻</a>
      </div>
    </div>
    <p class="mt-2 text-sm text-slate-400">
      Target: <code class="text-emerald-400">${report.url}</code> — score
      <strong class="text-white">${report.score}/100</strong> (${report.grade}). ${report.verified}
      of ${report.total_rules} rules passed, ${report.missing} need attention,
      ${report.not_applicable} not applicable. This is the same engine behind
      <a href="/scan" class="text-emerald-400 hover:text-emerald-300">/scan</a>.
    </p>
    <div class="mt-4 overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
            <th class="py-2 pr-4">Rule</th>
            <th class="py-2 pr-4">Category</th>
            <th class="py-2">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/60">
          ${report.assertions.map(
            (a) =>
              html`<tr>
                <td class="py-2 pr-4 text-slate-300">
                  <a href="/rules/${a.rule_id}" class="text-emerald-400 hover:text-emerald-300"
                    >${a.rule_id}</a
                  >
                  ${a.name}
                </td>
                <td class="py-2 pr-4 text-slate-500">${a.category}</td>
                <td class="py-2 font-medium ${STATUS_STYLE[a.status] ?? "text-slate-400"}">
                  ${a.status}
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
    <p class="mt-4 text-xs text-slate-500">
      Result is cached (refresh on request, not per pageview). What the scanner checks is exactly
      what is listed above — nothing more, nothing less.
    </p>
  </section>`;
}

export function AgentReadinessPage(state: SelfScanState, target: string) {
  return html`<div class="agent-readiness-page">
    <header class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-3xl">
        <h1 class="text-3xl md:text-5xl font-extrabold tracking-tight text-white">
          Agent Readiness, on ourselves
        </h1>
        <p class="mt-4 text-xl text-slate-400">
          We build tools that check whether websites work for AI agents. This page shows the same
          machinery applied to this very site.
        </p>
      </div>
    </header>
    <main class="px-4 pb-16 md:px-8">
      <div class="mx-auto max-w-3xl space-y-8">
        <section
          class="rounded-xl border border-slate-700 bg-slate-900/50 p-6"
          aria-label="Three representations"
        >
          <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500">
            One article, three representations
          </h2>
          <p class="mt-2 text-sm text-slate-400">
            Every blog article here is published in three forms from a single source:
          </p>
          <ul class="mt-4 space-y-3 text-sm">
            <li>
              <strong class="text-white">Human HTML</strong> — the page you read:
              <a href="/blog/arc-c29-task-board" class="text-emerald-400 hover:text-emerald-300"
                >/blog/arc-c29-task-board</a
              >
            </li>
            <li>
              <strong class="text-white">FOR AI AGENTS block</strong> — a visible summary on the
              same page (summary, status, concepts, actions, machine-readable links). No hidden
              markup — agents read what you read.
            </li>
            <li>
              <strong class="text-white">Knowledge Object (JSON)</strong> — the same metadata as a
              machine-readable object:
              <a
                href="/blog/arc-c29-task-board.json"
                class="text-emerald-400 hover:text-emerald-300"
                >/blog/arc-c29-task-board.json</a
              >
            </li>
          </ul>
          <p class="mt-4 text-sm text-slate-400">
            Claims carry statuses (VERIFIED / UNVERIFIED) and evidence links; actions point at
            things an agent can actually do. The HTML page links the JSON variant via
            <code class="text-emerald-400">rel="alternate"</code>, and this page does the same for
            itself:
            <a href="/agent-readiness.json" class="text-emerald-400 hover:text-emerald-300"
              >/agent-readiness.json</a
            >.
          </p>
        </section>
        ${ScanSection(state, target)}
        <section
          class="rounded-xl border border-slate-700 bg-slate-900/50 p-6"
          aria-label="What this does and does not show"
        >
          <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500">
            What this shows — and what it doesn't
          </h2>
          <ul class="mt-3 space-y-2 text-sm text-slate-400">
            <li>
              ✓ The scanner checked the listed signals on our homepage — llms.txt, manifests,
              structured data, markdown alternates.
            </li>
            <li>✓ The verdicts above are computed from fetched evidence, not asserted by hand.</li>
            <li>
              ✗ A passing score does not mean every page is covered — it reflects the scanned target
              only.
            </li>
            <li>✗ Rules marked NOT_APPLICABLE or GAP are listed plainly; we do not hide gaps.</li>
          </ul>
        </section>
      </div>
    </main>
  </div>`;
}
