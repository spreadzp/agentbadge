import { html, raw } from "hono/html";
import { type BlogArticle, type PaginationMeta } from "../server/lib/blog-data";

export interface TagFilterData {
  tagCounts: { tag: string; count: number }[];
  channels?: { key: string; label: string; count: number }[];
  activeTag?: string;
  activeChannel?: string;
}

/** SLICE-217-14: pagination links must keep the active filter in the query. */
function buildPageUrl(page: number, filter?: TagFilterData): string {
  const params = new URLSearchParams();
  if (filter?.activeChannel) params.set("channel", filter.activeChannel);
  if (filter?.activeTag) params.set("tag", filter.activeTag);
  if (page > 1) params.set("page", String(page));
  const q = params.toString();
  return q ? `/blog?${q}` : "/blog";
}

export function BlogListPage(items: BlogArticle[], meta: PaginationMeta, tagFilter?: TagFilterData) {
  const cards = items
    .map((a) => articleCard(a))
    .join("");
  const pagination = renderPagination(meta, tagFilter);
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
    <section class="px-4 pb-16 md:px-8">
      ${raw(filterNotice)}
      ${raw(pagination)}
      <div class="mx-auto max-w-6xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        ${raw(cards)}
      </div>
      ${raw(tagBar)}
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
  return `<div class="mx-auto max-w-6xl pt-6"><div class="mx-auto max-w-6xl">
    <div class="flex flex-wrap gap-2">${channelPills}</div>
    ${details}
  </div></div>`;
}

function renderPagination(meta: PaginationMeta, filter?: TagFilterData): string {
  if (meta.totalPages <= 1) return "";

  const pages: string[] = [];
  for (let i = 1; i <= meta.totalPages; i++) {
    const isCurrent = i === meta.currentPage;
    const link = buildPageUrl(i, filter);
    if (isCurrent) {
      pages.push(`<span aria-current="page" class="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white">${i}</span>`);
    } else {
      pages.push(`<a href="${link}" class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-400">${i}</a>`);
    }
  }

  const prevLink = buildPageUrl(meta.currentPage - 1, filter);
  const nextLink = buildPageUrl(meta.currentPage + 1, filter);
  const prevBtn = meta.hasPrev
    ? `<a href="${prevLink}" rel="prev" class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-400" aria-label="Previous page">← Prev</a>`
    : `<span class="rounded-lg border border-slate-800 px-3 py-2 text-sm font-medium text-slate-600" aria-disabled="true">← Prev</span>`;
  const nextBtn = meta.hasNext
    ? `<a href="${nextLink}" rel="next" class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-400" aria-label="Next page">Next →</a>`
    : `<span class="rounded-lg border border-slate-800 px-3 py-2 text-sm font-medium text-slate-600" aria-disabled="true">Next →</span>`;

  return `<nav aria-label="Pagination" class="mx-auto max-w-6xl my-6 flex items-center justify-center gap-2">
    ${prevBtn}
    ${pages.join("")}
    ${nextBtn}
  </nav>`;
}

/** SLICE-217-14: cut at a sentence/word boundary instead of mid-word. */
function truncateDesc(text: string, limit = 140): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentenceEnd >= limit * 0.5) return text.slice(0, sentenceEnd + 1);
  const wordEnd = cut.lastIndexOf(" ");
  return `${text.slice(0, wordEnd)}…`;
}

function articleCard(a: BlogArticle): string {
  const desc = truncateDesc(a.description);
  const thumb = a.heroImage
    ? `<img src="${a.heroImage}" alt="${a.title}" loading="lazy" class="h-40 w-full rounded-t-xl object-cover" />`
    : `<div class="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-t-xl bg-gradient-to-br from-slate-800 to-slate-900" aria-label="No cover image">
        <svg class="h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
        <span class="text-xs text-slate-600">AgentBadge</span>
      </div>`;
  const legacyBadge = a.legacy
    ? `<span class="rounded-full border border-amber-700/60 bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-400">legacy</span>`
    : "";
  return `<article class="blog-post flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900/50 transition-all hover:border-emerald-500">
    <a href="/blog/${a.slug}" class="block">${thumb}</a>
    <div class="flex flex-1 flex-col p-5">
      <div class="flex items-center gap-3 text-xs text-slate-500">
        <time datetime="${a.date}">${a.date}</time>
        <span>·</span>
        <span>${a.readingTime}</span>
        ${legacyBadge}
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
