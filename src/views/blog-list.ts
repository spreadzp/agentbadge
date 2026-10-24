import { html, raw } from "hono/html";
import { type BlogArticle, type PaginationMeta } from "../server/lib/blog-data";

export interface TagFilterData {
  tagCounts: { tag: string; count: number }[];
  channels?: { key: string; label: string; count: number }[];
  activeTag?: string;
  activeChannel?: string;
}

export function BlogListPage(items: BlogArticle[], meta: PaginationMeta, tagFilter?: TagFilterData) {
  const cards = items
    .map((a) => articleCard(a))
    .join("");
  const pagination = renderPagination(meta);
  const tagBar = tagFilter ? renderTagFilterBar(tagFilter) : "";
  const activeLabel = tagFilter?.activeTag
    ? `tagged: <span class="font-semibold text-emerald-400">${tagFilter.activeTag}</span>`
    : tagFilter?.activeChannel
      ? `in channel: <span class="font-semibold text-emerald-400">${tagFilter.channels.find((c) => c.key === tagFilter.activeChannel)?.label ?? tagFilter.activeChannel}</span>`
      : "";
  const filterNotice = activeLabel
    ? `<div class="mx-auto max-w-6xl mb-6 text-sm text-slate-400">Showing articles ${activeLabel} · <a href="/blog" class="text-emerald-400 underline hover:text-emerald-300">Clear filter</a></div>`
    : "";

  return html`<div class="blog-list">
    <section class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-4xl">
        <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
          AgentBadge Blog
        </div>
        <h1 class="mt-4 text-4xl md:text-5xl font-extrabold tracking-tight text-white">
          Insights on Agent Readiness
        </h1>
        <p class="mt-4 text-lg text-slate-400 max-w-2xl">
          Deep dives into agent-ready infrastructure, MCP protocol, x402 payments, and the agentic web.
        </p>
      </div>
    </section>
    ${raw(tagBar)}
    <section class="px-4 pb-16 md:px-8">
      ${raw(filterNotice)}
      <div class="mx-auto max-w-6xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        ${raw(cards)}
      </div>
      ${raw(pagination)}
    </section>
  </div>`;
}

function renderTagFilterBar(data: TagFilterData): string {
  const channels = data.channels ?? [];
  if (data.tagCounts.length === 0 && channels.length === 0) return "";
  const pillCls = (active: boolean) =>
    active
      ? "bg-emerald-500 text-white"
      : "border border-slate-700 text-slate-300 hover:border-emerald-500 hover:text-emerald-400";
  const channelPills = channels
    .map(
      ({ key, label, count }) =>
        `<a href="/blog?channel=${encodeURIComponent(key)}" class="rounded-full px-3 py-1.5 text-xs font-medium ${pillCls(data.activeChannel === key)}">${label} (${count})</a>`,
    )
    .join("");
  const tagPills = data.tagCounts
    .map(
      ({ tag, count }) =>
        `<a href="/blog?tag=${encodeURIComponent(tag)}" class="rounded-full px-3 py-1 text-xs font-medium ${pillCls(data.activeTag === tag)}">${tag} (${count})</a>`,
    )
    .join("");
  const details = tagPills
    ? `<details class="mt-3 group">
      <summary class="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-400 hover:border-emerald-500 hover:text-emerald-400 [&::-webkit-details-marker]:hidden">
        All tags (${data.tagCounts.length})
        <span class="transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div class="mt-3 flex flex-wrap gap-2">${tagPills}</div>
    </details>`
    : "";
  return `<div class="px-4 md:px-8 pt-4"><div class="mx-auto max-w-6xl">
    <div class="flex flex-wrap gap-2">${channelPills}</div>
    ${details}
  </div></div>`;
}

function renderPagination(meta: PaginationMeta): string {
  if (meta.totalPages <= 1) return "";

  const pages: string[] = [];
  for (let i = 1; i <= meta.totalPages; i++) {
    const isCurrent = i === meta.currentPage;
    const link = i === 1 ? "/blog" : `/blog?page=${i}`;
    if (isCurrent) {
      pages.push(`<span aria-current="page" class="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white">${i}</span>`);
    } else {
      pages.push(`<a href="${link}" class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-400">${i}</a>`);
    }
  }

  const prevLink = meta.currentPage === 2 ? "/blog" : `/blog?page=${meta.currentPage - 1}`;
  const nextLink = `/blog?page=${meta.currentPage + 1}`;
  const prevBtn = meta.hasPrev
    ? `<a href="${prevLink}" rel="prev" class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-400" aria-label="Previous page">← Prev</a>`
    : `<span class="rounded-lg border border-slate-800 px-3 py-2 text-sm font-medium text-slate-600" aria-disabled="true">← Prev</span>`;
  const nextBtn = meta.hasNext
    ? `<a href="${nextLink}" rel="next" class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-400" aria-label="Next page">Next →</a>`
    : `<span class="rounded-lg border border-slate-800 px-3 py-2 text-sm font-medium text-slate-600" aria-disabled="true">Next →</span>`;

  return `<nav aria-label="Pagination" class="mt-10 flex items-center justify-center gap-2">
    ${prevBtn}
    ${pages.join("")}
    ${nextBtn}
  </nav>`;
}

function articleCard(a: BlogArticle): string {
  const desc = a.description.length > 120 ? a.description.slice(0, 117) + "…" : a.description;
  const thumb = a.heroImage
    ? `<img src="${a.heroImage}" alt="${a.title}" loading="lazy" class="h-40 w-full rounded-t-xl object-cover" />`
    : `<div class="h-40 w-full rounded-t-xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center"><span class="text-3xl">📝</span></div>`;
  return `<article class="blog-post flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900/50 transition-all hover:border-emerald-500">
    <a href="/blog/${a.slug}" class="block">${thumb}</a>
    <div class="flex flex-1 flex-col p-5">
      <div class="flex items-center gap-3 text-xs text-slate-500">
        <time datetime="${a.date}">${a.date}</time>
        <span>·</span>
        <span>${a.readingTime}</span>
      </div>
      <h2 class="mt-3 text-lg font-bold text-white leading-snug">
        <a href="/blog/${a.slug}" class="hover:text-emerald-400">${a.title}</a>
      </h2>
      <p class="mt-2 text-sm text-slate-400 flex-1">${desc}</p>
      <div class="mt-3 flex flex-wrap gap-1.5">
        ${a.tags.slice(0, 3).map((t) => `<a href="/blog?tag=${encodeURIComponent(t)}" class="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400 hover:text-emerald-400">${t}</a>`).join("")}
      </div>
      <a href="/blog/${a.slug}" class="mt-4 inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300">
        Read more →
      </a>
    </div>
  </article>`;
}
