import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { WorkRequestRecord } from "../server/services/work-request-store";

export function WorkRequestDetailPage(wr: WorkRequestRecord) {
  const statusColors: Record<string, string> = {
    received: "bg-blue-500/10 text-blue-400 border-blue-500/40",
    human_review: "bg-yellow-500/10 text-yellow-400 border-yellow-500/40",
    needs_information: "bg-orange-500/10 text-orange-400 border-orange-500/40",
    accepted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/40",
    declined: "bg-red-500/10 text-red-400 border-red-500/40",
    completed: "bg-purple-500/10 text-purple-400 border-purple-500/40",
  };

  const statusClass = statusColors[wr.status] ?? "bg-slate-500/10 text-slate-400 border-slate-500/40";

  const content = html`
    <section class="mx-auto max-w-3xl px-4 py-8">
      <div class="rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span class="text-xs font-medium uppercase tracking-wider text-slate-500">Work Request</span>
            <h1 class="mt-1 text-2xl font-semibold text-white sm:text-3xl">${raw(wr.request.title)}</h1>
          </div>
          <span class="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${statusClass}">
            ${wr.status}
          </span>
        </div>

        <div class="mt-6 space-y-4">
          <div>
            <span class="text-xs font-medium uppercase tracking-wider text-emerald-400">Summary</span>
            <p class="mt-1 text-slate-300 leading-relaxed">${raw(wr.request.summary)}</p>
          </div>

          ${wr.request.requirements && wr.request.requirements.length > 0
      ? html`<div>
                <span class="text-xs font-medium uppercase tracking-wider text-emerald-400">Requirements</span>
                <ul class="mt-2 flex flex-wrap gap-2">
                  ${wr.request.requirements.map(
        (r) =>
          html`<li class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-slate-300">${raw(r)}</li>`,
      )}
                </ul>
              </div>`
      : ""}

          ${wr.preferred_contact
      ? html`<div>
                <span class="text-xs font-medium uppercase tracking-wider text-emerald-400">Preferred Contact</span>
                <p class="mt-1 text-slate-300">${wr.preferred_contact.channel}</p>
              </div>`
      : ""}

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <span class="text-xs font-medium uppercase tracking-wider text-slate-500">Created</span>
              <p class="mt-1 text-sm text-slate-400">${wr.created_at}</p>
            </div>
            <div>
              <span class="text-xs font-medium uppercase tracking-wider text-slate-500">Updated</span>
              <p class="mt-1 text-sm text-slate-400">${wr.updated_at}</p>
            </div>
          </div>
        </div>

        <div class="mt-8 border-t border-slate-800 pt-6">
          <span class="text-xs font-medium uppercase tracking-wider text-slate-500">Actions</span>
          <div class="mt-3 flex flex-col gap-3 sm:flex-row">
            <form method="POST" action="/work-requests/${wr.id}/accept" class="inline">
              <button type="submit"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors">
                Accept
              </button>
            </form>
            <form method="POST" action="/work-requests/${wr.id}/ask" class="inline flex gap-2">
              <input type="text" name="question" placeholder="Ask a question..."
                class="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
              <button type="submit"
                class="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 transition-colors">
                Ask
              </button>
            </form>
            <form method="POST" action="/work-requests/${wr.id}/decline" class="inline">
              <button type="submit"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors">
                Decline
              </button>
            </form>
          </div>
        </div>
      </div>

      <div class="mt-4 text-center">
        <a href="/api/work-requests/${wr.id}" class="text-sm text-slate-500 hover:text-slate-400">
          View as JSON (API)
        </a>
      </div>
    </section>
  `;

  return Layout(
    content.toString(),
    `Work Request — ${wr.request.title}`,
    {
      title: `Work Request — ${wr.request.title}`,
      description: "Private work request review page",
      path: `/work-requests/${wr.id}`,
    },
    undefined,
    true,
  );
}
