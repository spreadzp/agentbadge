/**
 * SLICE-199-12 (EPIC-199): /board — SSR kanban over arc task-board
 * cards. 7 columns (todo → cancelled); role-conditional action
 * affordances (data-action markers drive client JS / API calls).
 *
 * Uses hono/html `html` — interpolated values are auto-escaped
 * (XSS-safe for arbitrary spec/comment payloads).
 */
import { html } from "hono/html";
import type {
  BoardCardRecord,
  BoardEntryRecord,
} from "../server/lib/board/types";

export const BOARD_COLUMNS = [
  "todo",
  "in_progress",
  "testing",
  "review",
  "bug",
  "done",
  "cancelled",
] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

const COL_LABEL: Record<BoardColumn, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  testing: "Testing",
  review: "Review",
  bug: "Bug",
  done: "Done",
  cancelled: "Cancelled",
};

const COL_TINT: Record<BoardColumn, string> = {
  todo: "border-slate-700/60",
  in_progress: "border-sky-700/50",
  testing: "border-amber-700/50",
  review: "border-violet-700/50",
  bug: "border-red-700/60",
  done: "border-emerald-700/60",
  cancelled: "border-slate-800/70",
};

export interface BoardViewOpts {
  cards: BoardCardRecord[];
  attempts: Map<string, number>;
  me?: string;
  isReviewer?: boolean;
  filter: { column?: string; q?: string };
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}

function actionButtons(
  card: BoardCardRecord,
  me: string | undefined,
  isReviewer: boolean,
) {
  const btns: ReturnType<typeof html>[] = [];
  if (card.column === "todo") {
    btns.push(html`<button type="button" data-action="claim" data-card="${card.cardId}"
      class="rounded bg-sky-600/80 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-sky-500">Claim</button>`);
  }
  if (card.column === "bug" && me && card.currentPassportId === me) {
    btns.push(html`<button type="button" data-action="resubmit" data-card="${card.cardId}"
      class="rounded bg-amber-600/80 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-500">Resubmit fix</button>`);
  }
  if (card.column === "review" && isReviewer) {
    btns.push(html`<button type="button" data-action="review" data-card="${card.cardId}"
      class="rounded bg-violet-600/80 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-violet-500">Review</button>`);
  }
  if (card.column === "in_progress" && me && card.currentPassportId === me) {
    btns.push(html`<button type="button" data-action="submit" data-card="${card.cardId}"
      class="rounded bg-emerald-600/80 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500">Submit</button>`);
  }
  return btns;
}

function card(
  c: BoardCardRecord,
  attempt: number,
  me: string | undefined,
  isReviewer: boolean,
) {
  return html`
    <a href="/board/cards/${c.cardId}"
      class="block rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 space-y-1.5 hover:border-slate-600"
      data-card-id="${c.cardId}">
      <div class="flex items-start justify-between gap-2">
        <span class="font-mono text-[10px] text-sky-400/90">${shortId(c.cardId)}</span>
        ${attempt > 1
          ? html`<span class="rounded bg-amber-900/50 px-1 py-0.5 text-[9px] text-amber-300">attempt ${attempt}</span>`
          : ""}
      </div>
      <div class="text-sm leading-snug text-slate-200">${c.title}</div>
      <div class="flex items-center justify-between text-[10px] text-slate-500">
        <span>${c.budgetUsdc ? `$${c.budgetUsdc} USDC` : "—"}</span>
        <span>${c.currentPassportId ? shortId(c.currentPassportId) : "open"}</span>
      </div>
      ${c.column === "bug" && c.fixDeadlineMs
        ? html`<div class="rounded bg-red-900/30 px-1.5 py-0.5 text-[9px] text-red-300">fix by ${new Date(
            c.fixDeadlineMs,
          ).toISOString().slice(0, 16)}</div>`
        : ""}
      <div class="flex gap-1 pt-0.5">${actionButtons(c, me, isReviewer)}</div>
    </a>`;
}

export function renderBoardPage(opts: BoardViewOpts) {
  const { cards, attempts, me, isReviewer = false, filter } = opts;
  const byCol = new Map<BoardColumn, BoardCardRecord[]>();
  for (const col of BOARD_COLUMNS) byCol.set(col, []);
  for (const c of cards) byCol.get(c.column as BoardColumn)?.push(c);

  return html`
<div class="mx-auto max-w-[1700px] space-y-5">
  <header class="space-y-1.5">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold text-slate-100">Task Board</h1>
      <span class="rounded-full border border-sky-600/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">EPIC-199</span>
      <a href="/api/board/cards" class="ml-auto text-xs text-sky-400 hover:text-sky-300">JSON API ↗</a>
    </div>
    <p class="max-w-3xl text-sm text-slate-400">
      Agent task board — off-chain claims, escrowed payouts on Arc, reviewer verdicts.
    </p>
  </header>

  <form method="get" action="/board"
    class="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 text-xs">
    <label class="flex flex-col gap-1">column
      <select name="column" class="rounded bg-slate-800 px-2 py-1 text-slate-200">
        <option value="">all</option>
        ${BOARD_COLUMNS.map(
          (col) =>
            html`<option value="${col}" ${col === filter.column ? "selected" : ""}>${COL_LABEL[col]}</option>`,
        )}
      </select></label>
    <label class="flex flex-col gap-1">search
      <input name="q" value="${filter.q ?? ""}" placeholder="title / id"
        class="rounded bg-slate-800 px-2 py-1 text-slate-200 w-40" /></label>
    <label class="flex flex-col gap-1">me
      <input name="me" value="${me ?? ""}" placeholder="passport id"
        class="rounded bg-slate-800 px-2 py-1 text-slate-200 w-40" /></label>
    <button type="submit" class="rounded bg-sky-600 px-3 py-1.5 text-white hover:bg-sky-500">Apply</button>
    <a href="/board" class="rounded border border-slate-600 px-3 py-1.5 text-slate-400 hover:text-slate-200">Reset</a>
  </form>

  <section class="grid items-start gap-3"
    style="grid-template-columns: repeat(7, minmax(210px, 1fr))">
    ${BOARD_COLUMNS.map((col) => {
      const list = byCol.get(col) ?? [];
      return html`<div class="flex max-h-[74vh] flex-col rounded-lg border ${COL_TINT[col]} bg-slate-900/30"
        data-column="${col}">
        <h2 class="sticky top-0 z-10 flex items-center justify-between rounded-t-lg bg-slate-900/95 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 backdrop-blur">
          ${COL_LABEL[col]}
          <span class="rounded bg-slate-800 px-1.5 text-slate-500">${list.length}</span>
        </h2>
        <div class="flex-1 space-y-2 overflow-y-auto p-2">
          ${list.length
            ? list.map((c) =>
                card(c, attempts.get(c.cardId) ?? 1, me, isReviewer),
              )
            : html`<p class="p-2 text-center text-[10px] text-slate-600">—</p>`}
        </div>
      </div>`;
    })}
  </section>
</div>`;
}

/** Detail page — spec (authorized readers) + chronological journal. */
export function renderBoardCardDetail(opts: {
  card: BoardCardRecord;
  entries: BoardEntryRecord[];
  attempt: number;
  showSpec: boolean;
}) {
  const { card, entries, attempt, showSpec } = opts;
  return html`
<div class="mx-auto max-w-4xl space-y-5">
  <a href="/board" class="text-xs text-sky-400 hover:text-sky-300">← board</a>
  <header class="space-y-2">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold text-slate-100">${card.title}</h1>
      <span class="rounded-full border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300">${COL_LABEL[card.column as BoardColumn] ?? card.column}</span>
      ${attempt > 1
        ? html`<span class="rounded bg-amber-900/50 px-2 py-0.5 text-[11px] text-amber-300">attempt ${attempt}</span>`
        : ""}
    </div>
    <p class="text-xs text-slate-500">
      <span class="font-mono">${card.cardId}</span>
      · bounty <span class="font-mono">${card.bountyId}</span>
      ${card.budgetUsdc ? ` · $${card.budgetUsdc} USDC` : ""}
      ${card.currentPassportId ? ` · holder ${card.currentPassportId}` : ""}
      ${card.fixDeadlineMs
        ? ` · fix deadline ${new Date(card.fixDeadlineMs).toISOString()}`
        : ""}
    </p>
  </header>

  ${showSpec
    ? html`<section class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
        <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Spec</h2>
        <pre class="whitespace-pre-wrap text-sm text-slate-300">${card.spec}</pre>
        <p class="mt-2 font-mono text-[10px] text-slate-600">specHash ${card.specHash}</p>
      </section>`
    : ""}

  <section class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
    <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Journal</h2>
    ${entries.length === 0
      ? html`<p class="text-xs text-slate-600">No entries yet.</p>`
      : html`<ol class="space-y-2">
          ${entries.map(
            (e) => html`<li class="flex items-baseline gap-3 border-b border-slate-800/60 pb-2 text-xs"
              data-entry-id="${e.id}">
              <span class="w-8 shrink-0 text-right font-mono text-slate-600">#${e.seq}</span>
              <span class="w-24 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-center text-[10px] text-slate-300">${e.kind}</span>
              <span class="flex-1 text-slate-400">
                ${e.actor}
                ${e.payload?.comment
                  ? html` — ${e.payload.comment}`
                  : ""}
              </span>
              ${e.txHash
                ? html`<span class="font-mono text-[10px] text-sky-400">${shortId(e.txHash)}</span>`
                : ""}
              <span class="shrink-0 text-[10px] text-slate-600">${new Date(e.atMs).toISOString().slice(0, 16)}</span>
            </li>`,
          )}
        </ol>`}
  </section>
</div>`;
}
