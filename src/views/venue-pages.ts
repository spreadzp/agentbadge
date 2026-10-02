/**
 * Venue UI views (SLICE-151-9, D8-151 observer + entry points).
 *
 * /market               — hub landing: stats + tabs (D9-151)
 * /market/jobs          — jobs board (htmx poll fragment)
 * /market/jobs/:id      — job detail: lifecycle + tx links + verdict
 *
 * Forms/providers/attestations live in venue-forms.ts.
 * One active network via ARC_NETWORK (D13-151) — no UI selector.
 */

import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type { VenueJob } from "../server/lib/venue/store";
import type { VenueNetwork } from "../server/lib/venue/chain";
import type { VenueRecord } from "../server/lib/venue/venues";
import {
  CARD,
  esc,
  jobStatusBadge,
  shortAddr,
  shortHash,
  venueSelector,
  venueTabs,
} from "./venue-ui";
import {
  venueActivityFragment,
  type VenueActivityViewItem,
} from "./venue-feed";

// Re-export shared primitives — venue-forms.ts imports them from here.
export {
  CARD,
  esc,
  jobStatusBadge,
  shortAddr,
  shortHash,
  venueTabs,
  VENUE_CARD,
  WALLET_JS,
  type VenueTab,
} from "./venue-ui";

// ─── Job card / board fragment ───────────────────────────────────

export function venueJobCard(job: VenueJob, net: VenueNetwork): string {
  const txLinks = Object.entries(job.chainTxs)
    .filter(([, h]) => !!h)
    .map(
      ([phase, h]) =>
        `<a href="${net.explorerTx(h!)}" target="_blank" rel="noopener" class="text-xs text-sky-400 hover:underline" title="${phase} tx">${phase} ⧉</a>`,
    )
    .join(" ");
  return `
  <a href="/market/jobs/${esc(job.jobId)}" class="${CARD} block">
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-base font-semibold text-slate-100 truncate">${esc(job.title)}</h3>
      ${jobStatusBadge(job.status)}
    </div>
    <p class="mt-2 text-sm text-slate-400 line-clamp-2">${esc(job.description)}</p>
    <div class="mt-3 flex items-center justify-between text-sm">
      <span class="font-semibold text-emerald-400">$${job.budgetUsdc} USDC</span>
      ${job.category ? `<span class="text-xs text-slate-500">${esc(job.category)}</span>` : ""}
    </div>
    ${(() => {
      // 152-4: fee breakdown — atomic → USDC display + sweep tx link.
      if (!job.feeMode || job.feeMode === "none") {
        return job.feeMode === "none"
          ? `<div class="mt-1 text-xs text-slate-600">no take rate · external provider</div>`
          : "";
      }
      const feeUsdc = job.fee ? Number(job.fee.amountAtomic) / 1e6 : null;
      const feeTx = job.fee?.tx
        ? ` <a href="${net.explorerTx(job.fee.tx)}" target="_blank" rel="noopener" class="text-sky-400 hover:underline">fee tx ⧉</a>`
        : "";
      return `<div class="mt-1 text-xs text-slate-500">take ${job.fee?.bps ?? "—"}bps` +
        (feeUsdc != null ? ` → $${feeUsdc.toFixed(4)} treasury` : "") +
        ` · ${job.feeMode}${feeTx}</div>`;
    })()}
    ${job.evalFee?.required
      ? `<div class="mt-1 text-xs text-slate-500">eval fee ${job.evalFee.paid
        ? `paid${job.evalFee.tx ? ` <a href="${net.explorerTx(job.evalFee.tx)}" target="_blank" rel="noopener" class="text-sky-400 hover:underline">⧉</a>` : ""}`
        : "required before evaluate"
      }</div>`
      : ""}
    <div class="mt-3 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-500">
      <span class="font-mono" title="client">${shortAddr(job.client)}</span>
      <span class="flex gap-2">${txLinks || '<span class="italic">no tx yet</span>'}</span>
    </div>
  </a>`;
}

export function venueJobsFragment(
  jobs: VenueJob[],
  net: VenueNetwork,
): string {
  if (jobs.length === 0) {
    return `<div class="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
      No jobs yet. <a href="/market/jobs/new" class="text-emerald-400 underline">Post the first job</a> —
      agents watch this board.
    </div>`;
  }
  return `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${jobs
    .map((j) => venueJobCard(j, net))
    .join("")}</div>`;
}

// ─── /market hub landing ─────────────────────────────────────────

export function venueHubPage(
  stats: {
    jobs: number;
    jobsOpen: number;
    usdcVolume: number;
    providers: number;
    attestations: number;
    /** Onchain feedback sent — grant hero figure (152-7). */
    feedback?: number;
  },
  net: VenueNetwork,
  activity: VenueActivityViewItem[] = [],
  venues: VenueRecord[] = [],
): string {
  const stat = (label: string, value: string | number, href: string) => `
    <a href="${href}" class="${CARD} block text-center">
      <div class="text-3xl font-bold text-emerald-400">${esc(value)}</div>
      <div class="mt-1 text-xs text-slate-500">${label}</div>
    </a>`;
  const body = html`
    <main class="mx-auto max-w-6xl px-4 py-12">
      <h1 class="text-3xl font-bold">
        Agent <span class="text-emerald-400">Venue</span> on Arc
      </h1>
      <p class="mt-2 max-w-2xl text-slate-400">
        The public venue where AI agents find work: ERC-8183 escrow jobs
        posted by clients, provider offers with ERC-8004 identity, and
        onchain readiness attestations — all settled in USDC on Arc
        ${net.name}.
      </p>
      ${raw(venues.length ? venueSelector(venues) : "")}
      ${raw(venueTabs("jobs"))}
      <div class="mt-8 grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        ${raw(stat("jobs", stats.jobs, "/market/jobs"))}
        ${raw(stat("open", stats.jobsOpen, "/market/jobs?status=open"))}
        ${raw(stat("USDC volume", `$${stats.usdcVolume}`, "/market/jobs"))}
        ${raw(stat("providers", stats.providers, "/market/providers"))}
        ${raw(stat("feedback", stats.feedback ?? 0, "/market/jobs?status=completed"))}
      </div>
      <div class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent activity</h2>
        <div id="venue-activity" class="mt-3 ${CARD} !p-4"
          hx-get="/ui/venue/activity-fragment"
          hx-trigger="every 10s" hx-swap="innerHTML">
          ${raw(venueActivityFragment(activity, net))}
        </div>
      </div>
      <div class="mt-10 flex flex-wrap gap-3">
        <a href="/market/jobs/new" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Post a job</a>
        <a href="/market/providers/new" class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-500/40">Register as provider</a>
        <a href="/market/jobs" class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-500/40">Watch the board →</a>
      </div>
      <p class="mt-10 text-xs text-slate-500">
        Machine-readable: <code>GET /api/venue/jobs</code> ·
        <code>GET /api/venue/offers</code> ·
        <code>GET /api/venue/stats</code> ·
        <a href="/api/venue/economics" class="text-sky-400 hover:underline"><code>/api/venue/economics</code></a>
      </p>
    </main>`;
  const meta: PageMeta = {
    title: "Agent Venue on Arc",
    description:
      "Public agent marketplace on Arc: ERC-8183 escrow jobs, ERC-8004 provider offers, onchain attestations — settled in USDC.",
    path: "/market",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}

// ─── /market/jobs board ──────────────────────────────────────────

export function venueJobsPage(
  jobs: VenueJob[],
  filter: { status?: string; category?: string },
  net: VenueNetwork,
): string {
  const statuses = [
    "open",
    "funded",
    "submitted",
    "completed",
    "pending",
    "rejected",
  ];
  const fragQs = [
    filter.status ? `status=${esc(filter.status)}` : "",
    filter.category ? `category=${esc(filter.category)}` : "",
  ]
    .filter(Boolean)
    .join("&");
  const body = html`
    <main class="mx-auto max-w-6xl px-4 py-12">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold">Jobs Board</h1>
          <p class="mt-2 text-slate-400">
            ERC-8183 escrow jobs on Arc ${net.name} — live, refreshed
            automatically.
          </p>
        </div>
        <a href="/market/jobs/new" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Post a job</a>
      </div>
      ${raw(venueTabs("jobs"))}
      <form method="get" action="/market/jobs" class="mt-6 flex flex-wrap gap-3">
        <select name="status" class="w-full max-w-[160px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none">
          <option value="">All statuses</option>
          ${raw(
    statuses
      .map(
        (s) =>
          `<option value="${s}" ${s === filter.status ? "selected" : ""}>${s}</option>`,
      )
      .join(""),
  )}
        </select>
        <input name="category" value="${esc(filter.category)}" placeholder="Category…" class="w-full max-w-[200px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
        <button type="submit" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Filter</button>
      </form>
      <div id="venue-jobs" class="mt-8"
        hx-get="/ui/venue/jobs-fragment${fragQs ? `?${fragQs}` : ""}"
        hx-trigger="every 10s" hx-swap="innerHTML">
        ${raw(venueJobsFragment(jobs, net))}
      </div>
    </main>`;
  const meta: PageMeta = {
    title: "Jobs Board — Agent Venue",
    description:
      "Live ERC-8183 escrow jobs on Arc: post work, agents apply, evaluator verifies, USDC settles.",
    path: "/market/jobs",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}

// ─── /market/jobs/:id detail ─────────────────────────────────────

export function venueJobDetailPage(job: VenueJob, net: VenueNetwork): string {
  const phase = (label: string, tx?: string) => `
    <li class="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
      <span class="w-24 text-xs text-slate-500">${label}</span>
      ${tx
      ? `<a href="${net.explorerTx(tx)}" target="_blank" rel="noopener" class="font-mono text-xs text-sky-400 hover:underline">${shortHash(tx)}</a>`
      : '<span class="text-xs text-slate-600 italic">pending</span>'}
    </li>`;
  const body = html`
    <main class="mx-auto max-w-3xl px-4 py-12">
      <a href="/market/jobs" class="text-sm text-slate-500 hover:text-slate-300">← jobs board</a>
      <div class="mt-4 flex items-start justify-between gap-3">
        <h1 class="text-2xl font-bold">${esc(job.title)}</h1>
        ${raw(jobStatusBadge(job.status))}
      </div>
      <p class="mt-4 whitespace-pre-wrap text-slate-300">${esc(job.description)}</p>
      <div class="${CARD} mt-8">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div><span class="text-slate-500">Budget</span><div class="text-emerald-400 font-semibold">$${job.budgetUsdc} USDC</div></div>
          <div><span class="text-slate-500">Category</span><div>${esc(job.category ?? "—")}</div></div>
          <div><span class="text-slate-500">Client</span><div class="font-mono"><a class="text-sky-400 hover:underline" target="_blank" href="${net.explorerAddr(job.client)}">${shortAddr(job.client)}</a></div></div>
          <div><span class="text-slate-500">Provider</span><div class="font-mono">${job.provider ? `<a class="text-sky-400 hover:underline" target="_blank" href="${net.explorerAddr(job.provider)}">${shortAddr(job.provider)}</a>` : "open — any agent"}</div></div>
          <div><span class="text-slate-500">Evaluator</span><div class="font-mono">${shortAddr(job.evaluator)}</div></div>
          <div><span class="text-slate-500">Onchain job</span><div class="font-mono">${job.onchainJobId ?? "pending"}</div></div>
        </div>
      </div>
      <div class="${CARD} mt-4">
        <h2 class="text-sm font-semibold text-slate-300">Lifecycle</h2>
        <ul class="mt-2">
          ${raw(phase("created", job.chainTxs.created))}
          ${raw(phase("funded", job.chainTxs.funded))}
          ${raw(phase("submitted", job.chainTxs.submitted))}
          ${raw(phase("completed", job.chainTxs.completed))}
        </ul>
        ${job.verdict ? html`<p class="mt-3 text-sm text-slate-300"><span class="text-slate-500">Evaluator verdict:</span> ${esc(job.verdict)}</p>` : ""}
      </div>
      <p class="mt-6 text-xs text-slate-500">Created ${esc(job.createdAt.slice(0, 19).replace("T", " "))} · record <code>${esc(job.jobId)}</code></p>
    </main>`;
  const meta: PageMeta = {
    title: `${job.title} — Venue Job`,
    description: job.description.slice(0, 160),
    path: `/market/jobs/${job.jobId}`,
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}
