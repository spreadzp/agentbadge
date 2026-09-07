import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { AUDIT_RUNS, getAuditSummary } from "../server/lib/notes-data";
import { pageCoreSchemas, webPageLd, breadcrumbFor } from "../server/lib/json-ld";

export function NotesPage(jsonLd?: object[]) {
  const summary = getAuditSummary();

  const resultBadge = (result: string) => {
    const styles: Record<string, string> = {
      success: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40",
      partial: "bg-amber-500/10 text-amber-300 border border-amber-500/40",
      failed: "bg-red-500/10 text-red-300 border border-red-500/40",
    };
    return `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[result] ?? styles.failed}">${result}</span>`;
  };

  const auditCard = (audit: (typeof AUDIT_RUNS)[0]["audits"][0]) => `
    <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span class="text-sm font-semibold text-white">${audit.agent}</span>
          <span class="text-xs text-slate-500 ml-2">${audit.date}</span>
        </div>
        ${resultBadge(audit.result)}
      </div>
      <p class="mt-2 text-xs text-slate-400">${audit.task}</p>
      ${audit.failure_points.length > 0 ? `
        <div class="mt-3">
          <span class="text-xs font-medium uppercase tracking-wider text-red-400">Failure Points</span>
          <ul class="mt-1 space-y-1">
            ${audit.failure_points.map((fp) => `<li class="text-xs text-slate-400 flex gap-2"><span class="text-red-400">✗</span> ${fp}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
      ${audit.fixes_applied.length > 0 ? `
        <div class="mt-3">
          <span class="text-xs font-medium uppercase tracking-wider text-emerald-400">Fixes Applied</span>
          <ul class="mt-1 space-y-1">
            ${audit.fixes_applied.map((fx) => `<li class="text-xs text-slate-400 flex gap-2"><span class="text-emerald-400">✓</span> ${fx}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
      <p class="mt-3 text-xs text-slate-400 italic">${audit.notes}</p>
    </div>`;

  const runSection = (run: (typeof AUDIT_RUNS)[0]) => `
    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 class="text-xl font-semibold text-white">${run.title}</h2>
          <p class="text-xs text-slate-500 mt-1">${run.date} — ${run.agents_succeeded}/${run.agents_tested} agents succeeded</p>
        </div>
        <code class="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-lg max-w-full overflow-x-auto">"${run.prompt}"</code>
      </div>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        ${run.audits.map(auditCard).join("")}
      </div>
    </section>`;

  const content = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Engineering Notes</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Self-Audit Notes</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        We run AI agents against agentbadge.xyz and publish what broke and what we fixed.
        Radical transparency for agent readiness — following the pact0.com model.
      </p>
      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-center">
          <div class="text-2xl font-bold text-white">${summary.agents_tested}</div>
          <div class="text-xs text-slate-400">Agents Tested</div>
        </div>
        <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-center">
          <div class="text-2xl font-bold text-emerald-400">${summary.agents_succeeded}</div>
          <div class="text-xs text-slate-400">Succeeded</div>
        </div>
        <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-center">
          <div class="text-2xl font-bold text-red-400">${summary.total_failures}</div>
          <div class="text-xs text-slate-400">Failures</div>
        </div>
        <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-center">
          <div class="text-2xl font-bold text-amber-400">${summary.total_fixes}</div>
          <div class="text-xs text-slate-400">Fixes Applied</div>
        </div>
      </div>
    </section>

    ${raw(AUDIT_RUNS.map(runSection).join(""))}

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">Methodology</h2>
      <p class="mt-2 text-sm text-slate-300">
        Each audit run gives an AI agent a one-liner prompt (e.g., "Read llms.txt and register an agent").
        We record full traces: where the agent succeeded, where it failed, and what we fixed.
        Fix descriptions reference the specific change made to the codebase or documentation.
      </p>
      <p class="mt-2 text-sm text-slate-400">
        Machine-readable version: <a href="/notes.json" class="text-emerald-400 hover:underline">/notes.json</a>
      </p>
    </section>
  `;

  const schemas = jsonLd ?? [
    ...pageCoreSchemas(),
    webPageLd({
      title: "Self-Audit Notes — AgentBadge",
      description:
        "Public engineering notes: we run AI agents against agentbadge.xyz, document what broke and what was fixed. Radical transparency for agent readiness.",
      path: "/notes",
    }),
    breadcrumbFor("/notes", "Notes"),
  ];

  return Layout(
    content.toString(),
    "Self-Audit Notes",
    {
      title: "Self-Audit Notes",
      description:
        "Public engineering notes: we run AI agents against agentbadge.xyz, document what broke and what was fixed.",
      path: "/notes",
    },
    schemas,
  );
}
