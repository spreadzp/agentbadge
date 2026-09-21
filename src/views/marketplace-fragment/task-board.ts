import { html } from "hono/html";
import type { MarketTask } from "../../server/lib/market-task.js";
import { PAGE_SIZE, shortDid, explorerLinks, statusBadge } from "./helpers";

export function TaskCard({ task }: { task: MarketTask }) {
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
        <span class="font-mono text-slate-600" title="Task ID">${task.id}</span>
        <button
          type="button"
          title="Copy Task ID"
          class="text-slate-600 hover:text-emerald-400 transition-colors cursor-pointer"
          onclick="navigator.clipboard.writeText('${task.id}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
        >⧉</button>
      </div>
      <p class="mt-1 text-xs text-slate-400 line-clamp-2">${descPreview}</p>
      <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
        <span class="text-emerald-400 font-medium">${task.price}</span>
        <span>${task.capabilities.join(", ")}</span>
      </div>
      <div class="mt-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-500" title="${task.posterDid}">${shortDid(task.posterDid)}</span>
          ${explorerLinks(task.txId)}
        </div>
        <div class="flex items-center gap-3">
          <a
            href="/ui/medical-demo/${task.id}"
            class="text-xs text-emerald-400 hover:text-emerald-300"
            title="Medical Demo for this task"
          >Demo</a>
          <a
            href="/ui/market/tasks/${task.id}"
            class="text-xs text-blue-400 hover:text-blue-300"
          >View Details</a>
        </div>
      </div>
    </div>
  `;
}

export function MarketplaceTaskBoardFragment(tasks: MarketTask[]) {
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
