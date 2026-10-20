/**
 * SLICE-198-1: ops taskboard view — kanban over Backlog.md tasks.
 *
 * Uses hono/html `html` template — interpolated values are escaped
 * automatically (XSS-safe for arbitrary backlog frontmatter).
 */

import { html } from "hono/html";
import { isMineTask } from "../server/lib/ops-board/store";
import type {
  BoardData,
  BoardFilters,
  BoardSort,
  BoardTask,
} from "../server/lib/ops-board/store";

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-500/20 text-red-300 border-red-500/40",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  low: "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

function qs(f: BoardFilters, sort: BoardSort, extra: Record<string, string>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, sort } as Record<
    string,
    string | number | undefined
  >)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function card(t: BoardTask, me?: string) {
  const mine = isMineTask(t, me);
  const badge =
    PRIORITY_BADGE[t.priority] ??
    "bg-slate-500/10 text-slate-500 border-slate-600/30";
  return html`
    <div id="task-${t.id}" class="rounded-lg border p-3 space-y-2 ${mine
      ? "border-emerald-500/60 bg-emerald-900/10 ring-1 ring-emerald-500/30"
      : "border-slate-700/60 bg-slate-800/40"}">
      <div class="flex items-start justify-between gap-2">
        <span class="font-mono text-xs text-sky-400/90">${t.id}</span>
        <span class="flex items-center gap-1">
          ${mine
      ? html`<span class="rounded border border-emerald-500/50 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">mine</span>`
      : ""}
          <span class="rounded border px-1.5 py-0.5 text-[10px] ${badge}">${t.priority || "—"}</span>
        </span>
      </div>
      <div class="text-sm text-slate-200 leading-snug">${t.title}</div>
      <div class="flex flex-wrap gap-1">
        ${t.labels.map(
        (l) =>
          html`<span class="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300">${l}</span>`,
      )}
      </div>
      <div class="flex items-center justify-between text-[10px] text-slate-500">
        <span>${t.assignee.join(", ") || "unassigned"}</span>
        <span>${t.budget != null ? `$${t.budget}` : ""}${t.updatedDate ? ` · ${t.updatedDate.slice(0, 10)}` : ""}</span>
      </div>
    </div>`;
}

export function renderOpsBoard(opts: {
  data: BoardData;
  tasks: BoardTask[];
  filters: BoardFilters;
  sort: BoardSort;
}) {
  const { data, tasks, filters, sort } = opts;
  const byStatus = new Map<string, BoardTask[]>();
  for (const s of data.statuses) byStatus.set(s, []);
  for (const t of tasks) byStatus.get(t.status)?.push(t);

  const myTasks = filters.me
    ? data.tasks.filter((t) => isMineTask(t, filters.me))
    : [];

  const done = data.tasks.filter((t) => t.status === "Done").length;
  const pct = data.tasks.length
    ? Math.round((done / data.tasks.length) * 100)
    : 0;

  return html`
<div class="mx-auto max-w-[1600px] space-y-5">
  <header class="space-y-1.5">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold text-slate-100">Ops Board</h1>
      <span class="rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">read-only</span>
      <a href="/api/ops/board.json" class="ml-auto text-xs text-sky-400 hover:text-sky-300">JSON API ↗</a>
    </div>
    <p class="max-w-3xl text-sm text-slate-400">
      Live progress of Backlog.md tasks across all projects. Enter your wallet, passport or handle
      below to highlight the tasks that involve you.
    </p>
    <p class="text-[11px] text-slate-500">
      Updated ${new Date(data.scannedAt).toISOString()}${data.skipped ? ` · ${data.skipped} files skipped` : ""}
    </p>
  </header>

  <section class="flex flex-wrap gap-3 text-xs">
    <span class="rounded border border-slate-700 px-2 py-1">total ${data.tasks.length}</span>
    ${data.statuses.map(
    (s) =>
      html`<span class="rounded border border-slate-700 px-2 py-1">${s}: ${data.tasks.filter((t) => t.status === s).length}</span>`,
  )}
    <span class="rounded border border-emerald-700/50 px-2 py-1 text-emerald-300">done ${pct}%</span>
  </section>

  ${data.epicStats.length
      ? html`<details class="group rounded-lg border border-sky-800/40 bg-sky-950/20">
        <summary class="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-2 text-xs text-sky-200">
          <span class="font-semibold uppercase tracking-wide">Epics</span>
          <span class="text-slate-500">${data.epicStats.length} total · ${data.epicStats.filter((e) => e.done < e.total).length} open</span>
          <span class="ml-auto text-slate-500 group-open:hidden">show ▾</span>
          <span class="ml-auto hidden text-slate-500 group-open:inline">hide ▴</span>
        </summary>
        <div class="space-y-2 border-t border-sky-800/30 p-3">
          <input type="search" data-epic-filter placeholder="filter epics…"
            class="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 md:w-64" />
          <div class="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto" data-epic-list>
            ${data.epicStats.map(
        (e) =>
          html`<a href="${qs(filters, sort, { epic: e.epic })}" data-epic-name="${e.epic}"
              class="rounded border px-2 py-0.5 text-[11px] ${e.done === e.total
              ? "border-slate-700 text-slate-500"
              : "border-sky-700/50 bg-sky-900/20 text-sky-200"} hover:bg-sky-800/30">${e.epic} <span class="tabular-nums">${e.done}/${e.total}</span></a>`,
      )}
          </div>
        </div>
      </details>`
      : ""}

  ${filters.me
      ? html`<details open class="rounded-lg border border-emerald-700/50 bg-emerald-950/20">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-emerald-300">
          <span class="font-semibold uppercase tracking-wide">My tasks</span>
          <span class="truncate text-emerald-200/80">${filters.me}</span>
          <span class="ml-auto rounded bg-emerald-900/60 px-1.5 text-emerald-400">${myTasks.length}</span>
        </summary>
        ${myTasks.length === 0
          ? html`<p class="border-t border-emerald-800/30 px-3 py-2 text-xs text-slate-500">No tasks match this identity.</p>`
          : html`<div class="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto border-t border-emerald-800/30 p-3">
              ${myTasks.map(
            (t) => html`<a href="#task-${t.id}"
                  class="rounded border border-emerald-600/50 bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-800/40">${t.id} · ${t.status}</a>`,
          )}
            </div>`}
      </details>`
      : ""}

  <form method="get" action="/ops/board"
    class="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 text-xs">
    <label class="flex flex-col gap-1">status
      <select name="status" class="rounded bg-slate-800 px-2 py-1 text-slate-200">
        <option value="">all</option>
        ${data.statuses.map(
        (s) =>
          html`<option value="${s}" ${s === filters.status ? "selected" : ""}>${s}</option>`,
      )}
      </select></label>
    <label class="flex flex-col gap-1">label
      <select name="label" class="rounded bg-slate-800 px-2 py-1 text-slate-200">
        <option value="">all</option>
        ${data.labels.map(
        (l) =>
          html`<option value="${l}" ${l === filters.label ? "selected" : ""}>${l}</option>`,
      )}
      </select></label>
    <label class="flex flex-col gap-1">milestone
      <select name="milestone" class="rounded bg-slate-800 px-2 py-1 text-slate-200">
        <option value="">all</option>
        ${data.milestones.map(
        (m) =>
          html`<option value="${m}" ${m === filters.milestone ? "selected" : ""}>${m}</option>`,
      )}
      </select></label>
    <label class="flex flex-col gap-1">search
      <input name="q" value="${filters.q ?? ""}" placeholder="title / id"
        class="rounded bg-slate-800 px-2 py-1 text-slate-200 w-36" /></label>
    <label class="flex flex-col gap-1">me
      <input id="me-input" name="me" value="${filters.me ?? ""}"
        placeholder="wallet / passport / handle"
        class="rounded bg-slate-800 px-2 py-1 text-slate-200 w-44" /></label>
    <label class="flex flex-col gap-1">budget ≥
      <input name="budget_min" type="number" min="0" value="${filters.budgetMin ?? ""}"
        class="rounded bg-slate-800 px-2 py-1 text-slate-200 w-20" /></label>
    <label class="flex flex-col gap-1">budget ≤
      <input name="budget_max" type="number" min="0" value="${filters.budgetMax ?? ""}"
        class="rounded bg-slate-800 px-2 py-1 text-slate-200 w-20" /></label>
    <label class="flex flex-col gap-1">sort
      <select name="sort" class="rounded bg-slate-800 px-2 py-1 text-slate-200">
        ${(["priority", "updated", "budget_asc", "budget_desc"] as const).map(
        (s) =>
          html`<option value="${s}" ${s === sort ? "selected" : ""}>${s}</option>`,
      )}
      </select></label>
    <button type="submit" class="rounded bg-sky-600 px-3 py-1.5 text-white hover:bg-sky-500">Apply</button>
    <a href="/ops/board" class="rounded border border-slate-600 px-3 py-1.5 text-slate-400 hover:text-slate-200">Reset</a>
  </form>

  ${tasks.length === 0
      ? html`<p class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-8 text-center text-slate-500">No tasks match the filters.</p>`
      : html`<section class="grid items-start gap-3" style="grid-template-columns: repeat(${Math.min(byStatus.size, 5)}, minmax(240px, 1fr))">
        ${[...byStatus.entries()].map(
        ([status, list]) =>
          html`<div class="flex max-h-[72vh] flex-col rounded-lg border border-slate-800/60 bg-slate-900/30">
              <h2 class="sticky top-0 z-10 flex items-center justify-between rounded-t-lg bg-slate-900/95 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 backdrop-blur">
                ${status}
                <span class="rounded bg-slate-800 px-1.5 text-slate-500">${list.length}</span>
              </h2>
              <div class="flex-1 space-y-2 overflow-y-auto p-2">${list.map((t) => card(t, filters.me))}</div>
            </div>`,
      )}
      </section>`}
</div>
<script>
// Persist the "me" identity in localStorage: on load, restore it into the
// input when the URL has no me param; on form submit, save whatever was
// entered. Keep it dumb — one field, one key.
(function () {
  var epicFilter = document.querySelector("[data-epic-filter]");
  if (epicFilter) {
    epicFilter.addEventListener("input", function () {
      var q = epicFilter.value.trim().toLowerCase();
      document.querySelectorAll("[data-epic-name]").forEach(function (el) {
        var hit = !q || el.getAttribute("data-epic-name").toLowerCase().indexOf(q) !== -1;
        el.style.display = hit ? "" : "none";
      });
    });
  }
  var input = document.getElementById("me-input");
  if (!input) return;
  var saved = localStorage.getItem("ops-board-me");
  if (saved && !new URLSearchParams(location.search).get("me")) {
    input.value = saved;
    input.form && input.form.requestSubmit();
  }
  var form = input.closest("form");
  if (form) {
    form.addEventListener("submit", function () {
      if (input.value.trim()) localStorage.setItem("ops-board-me", input.value.trim());
      else localStorage.removeItem("ops-board-me");
    });
  }
})();
</script>`;
}
