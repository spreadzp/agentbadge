/**
 * SLICE-151-3: Public attestations page.
 *
 * Lists onchain readiness attestations (ERC-8004 feedback + memo on Arc)
 * with explorer links — the live-link artifact for the microgrant.
 * Venue tab shell mounts the same fragment under /market in 151-9.
 */

import { html } from "hono/html";
import { Layout } from "./layout";
import type { AttestationEntry } from "../server/lib/attestation-store";

function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h;
}

function entryRow(e: AttestationEntry, explorerUrl: string) {
  const feedbackLink = `${explorerUrl}/tx/${e.feedbackTx}`;
  const memoLink = `${explorerUrl}/tx/${e.memoTx}`;
  const statusColor =
    e.score >= 70
      ? "text-emerald-400"
      : e.score >= 40
        ? "text-amber-400"
        : "text-rose-400";
  return html`<tr class="border-t border-slate-700/50">
    <td class="px-4 py-3">
      <a href="${e.url}" target="_blank" rel="noopener" class="text-sky-400 hover:underline">${e.domain}</a>
    </td>
    <td class="px-4 py-3 font-mono ${statusColor}">${e.score}</td>
    <td class="px-4 py-3 text-slate-300">${e.status}</td>
    <td class="px-4 py-3 font-mono text-slate-400">${e.agentId}</td>
    <td class="px-4 py-3">
      <a href="${feedbackLink}" target="_blank" rel="noopener" class="font-mono text-sky-400 hover:underline" title="giveFeedback tx">${shortHash(e.feedbackTx)}</a>
    </td>
    <td class="px-4 py-3">
      <a href="${memoLink}" target="_blank" rel="noopener" class="font-mono text-sky-400 hover:underline" title="memo tx">${shortHash(e.memoTx)}</a>
    </td>
    <td class="px-4 py-3 text-slate-500 text-sm">${e.createdAt.slice(0, 19).replace("T", " ")}</td>
  </tr>`;
}

export function AttestationsPage(
  entries: AttestationEntry[],
  explorerUrl: string,
) {
  const rows =
    entries.length === 0
      ? html`<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">No attestations yet — POST /api/attestations { "url": "…" }</td></tr>`
      : html`${entries.map((e) => entryRow(e, explorerUrl))}`;

  const content = html`
    <main class="mx-auto max-w-6xl px-4 py-10">
      <h1 class="text-3xl font-bold tracking-tight">
        Onchain <span class="text-emerald-400">Attestations</span>
      </h1>
      <p class="mt-2 max-w-2xl text-slate-400">
        Every website readiness scan is attested on Arc as ERC-8004
        reputation feedback plus a memo carrying the report hash —
        a verifiable certificate anyone can check on the explorer.
      </p>
      <div class="mt-8 overflow-x-auto rounded-xl border border-slate-700/50 bg-slate-900/30">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-700/50 text-slate-400">
            <tr>
              <th class="px-4 py-3 font-medium">Site</th>
              <th class="px-4 py-3 font-medium">Score</th>
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="px-4 py-3 font-medium">Agent</th>
              <th class="px-4 py-3 font-medium">Feedback tx</th>
              <th class="px-4 py-3 font-medium">Memo tx</th>
              <th class="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="mt-4 text-sm text-slate-500">
        Attest your site:
        <code class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">POST /api/attestations {"url": "https://yoursite.com"}</code>
      </p>
    </main>
  `;

  return Layout(content, "Attestations", {
    title: "Onchain Attestations — AgentBadge",
    description:
      "Website readiness scans attested on Arc blockchain as ERC-8004 reputation feedback with explorer-verifiable proof.",
    path: "/attestations",
  });
}
