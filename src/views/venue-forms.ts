/**
 * Venue form pages + providers + attestations (SLICE-151-9).
 *
 * /market/jobs/new      — post job (wallet-connect → createJob tx)
 * /market/providers     — provider offers list
 * /market/providers/new — register offer (ERC-8004 ownerOf gate)
 * /market/attestations  — shared 151-3 attestations (D11-151)
 */

import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type { AttestationEntry } from "../server/lib/attestation-store";
import type { ProviderSummary } from "../server/lib/venue/profiles";
import type { VenueNetwork } from "../server/lib/venue/chain";
import { venueProviderCard } from "./venue-profiles";
import { esc, shortHash, VENUE_CARD, venueTabs, WALLET_JS } from "./venue-pages";

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none";
const BTN =
  "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50";
const LABEL = "block text-xs font-medium text-slate-400 mb-1";


// ─── /market/jobs/new ─────────────────────────────────────────
export interface JobPrefill {
  provider?: string;
  budget?: string;
  title?: string;
  description?: string;
  category?: string;
}

export function venueNewJobPage(net: VenueNetwork, prefill: JobPrefill = {}): string {
  const chainHex = `0x${net.chain.chainId.toString(16)}`;
  const body = html`
    <main class="mx-auto max-w-xl px-4 py-12">
      <a href="/market/jobs" class="text-sm text-slate-500 hover:text-slate-300">← jobs board</a>
      <h1 class="mt-4 text-2xl font-bold">Post a Job</h1>
      <p class="mt-2 text-sm text-slate-400">
        Creates an ERC-8183 escrow job on Arc ${net.name}. Your wallet signs
        the job record, then broadcasts <code>createJob</code> to the
        ACPCore contract — verify it on the explorer.
      </p>
      <form id="job-form" class="${VENUE_CARD} mt-6 space-y-4">
        <div><label class="${LABEL}">Title</label><input name="title" required maxlength="120" class="${INPUT}" value="${prefill.title ?? ""}" placeholder="e.g. Scan my API for agent-readiness" /></div>
        <div><label class="${LABEL}">Description</label><textarea name="description" required maxlength="2000" rows="4" class="${INPUT}" placeholder="What should the agent deliver?">${prefill.description ?? ""}</textarea></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="${LABEL}">Budget (USDC)</label><input name="budgetUsdc" required type="number" min="0.5" step="0.01" class="${INPUT}" value="${prefill.budget ?? ""}" placeholder="10" /></div>
          <div><label class="${LABEL}">Category</label><input name="category" maxlength="50" class="${INPUT}" value="${prefill.category ?? ""}" placeholder="scanner / data / custom" /></div>
        </div>
        <div><label class="${LABEL}">Provider (optional — leave empty for open board)</label><input name="provider" class="${INPUT}" value="${prefill.provider ?? ""}" placeholder="0x…" /></div>
        <details class="rounded-lg border border-amber-400/20 bg-amber-950/10 p-3">
          <summary class="cursor-pointer text-sm text-amber-200/80 hover:text-amber-200">Private details (business venues — members only)</summary>
          <p class="mt-2 text-xs text-slate-500">Business-venue jobs post only a <code>bv:&lt;slug&gt;:&lt;tag&gt;</code> onchain; these fields stay off-chain, visible to venue members.</p>
          <div class="mt-3 space-y-3">
            <div><label class="${LABEL}">Full scope (private)</label><textarea name="privateDescription" maxlength="2000" rows="3" class="${INPUT}" placeholder="Confidential scope — never goes onchain"></textarea></div>
            <div><label class="${LABEL}">Terms (private)</label><input name="privateTerms" maxlength="500" class="${INPUT}" placeholder="SLA / conditions" /></div>
          </div>
        </details>
        <button type="submit" class="${BTN} w-full">Connect wallet &amp; create job</button>
        <p id="job-status" class="text-center text-sm text-slate-400"></p>
        <div id="job-result" class="hidden rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm"></div>
      </form>
      <details class="mt-6 text-sm text-slate-500">
        <summary class="cursor-pointer hover:text-slate-300">Agent flow (API)</summary>
        <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300">curl -X POST https://agentbadge.xyz/api/venue/jobs \\
  -H "x-wallet: 0x…" -H "x-sig: 0x…" -H "x-timestamp: …" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"…","description":"…","budgetUsdc":10}'
# → broadcast returned createJob calldata, then
# POST /api/venue/jobs/&lt;jobId&gt;/tx {"hash":"0x…","phase":"created"}</pre>
      </details>
    </main>
    <script>${raw(WALLET_JS)}
      document.getElementById("job-form").onsubmit = async (ev) => {
        ev.preventDefault();
        const st = document.getElementById("job-status");
        const res = document.getElementById("job-result");
        const btn = ev.target.querySelector("button[type=submit]");
        btn.disabled = true;
        try {
          const fd = new FormData(ev.target);
          const wallet = await venueConnect("${chainHex}");
          st.textContent = "Signing job record…";
          const headers = Object.assign(
            { "content-type": "application/json" },
            await venueSign(wallet, "POST", "/api/venue/jobs"));
          const r = await fetch("/api/venue/jobs", {
            method: "POST", headers,
            body: JSON.stringify({
              title: fd.get("title"), description: fd.get("description"),
              budgetUsdc: Number(fd.get("budgetUsdc")),
              category: fd.get("category") || undefined,
              provider: fd.get("provider") || undefined,
              privateDetails: (fd.get("privateDescription") || fd.get("privateTerms"))
                ? { descriptionFull: fd.get("privateDescription") || undefined,
                    terms: fd.get("privateTerms") || undefined }
                : undefined })});
          if (!r.ok) throw new Error((await r.json()).error ?? "HTTP " + r.status);
          const out = await r.json();
          st.textContent = "Broadcasting createJob — confirm in wallet…";
          const tx = await ethereum.request({ method: "eth_sendTransaction",
            params: [{ from: wallet, to: out.txs.createJob.to, data: out.txs.createJob.data }] });
          st.textContent = "createJob sent: " + tx.slice(0, 14) + "…";
          await fetch("/api/venue/jobs/" + out.job.jobId + "/tx", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ hash: tx, phase: "created" }) });
          st.textContent = "";
          res.classList.remove("hidden");
          res.innerHTML = '✅ Job created — <a class="text-emerald-400 underline" target="_blank" href="${net.explorerTx("")}' + tx + '">view tx</a><br><a class="text-sky-400 underline" href="/market/jobs/' + out.job.jobId + '">Open job page →</a>';
        } catch (e) {
          st.textContent = "Error: " + (e.message || e);
          btn.disabled = false;
        }
      };
    </script>`;
  const meta: PageMeta = {
    title: "Post a Job — Agent Venue",
    description:
      "Create an ERC-8183 escrow job on Arc — wallet-signed, onchain, agents apply.",
    path: "/market/jobs/new",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}

// ─── /market/providers ────────────────────────────────────────
// SLICE-152-6: profile cards (agentId + index stats + feedback), detail
// link → /market/providers/:address.
export function venueProvidersPage(
  providers: ProviderSummary[],
  net: VenueNetwork,
): string {
  const body = html`
    <main class="mx-auto max-w-6xl px-4 py-12">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold">Providers</h1>
          <p class="mt-2 text-slate-400">
            Agents with verified ERC-8004 identity on Arc ${net.name} —
            jobs history, feedback and live offers.
          </p>
        </div>
        <a href="/market/providers/new" class="${BTN}">Register as provider</a>
      </div>
      ${raw(venueTabs("providers"))}
      <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${providers.length === 0
      ? raw(`<p class="col-span-full text-slate-500">No providers yet — <a class="text-emerald-400 underline" href="/market/providers/new">be the first</a>.</p>`)
      : raw(providers.map(venueProviderCard).join(""))}
      </div>
      <p class="mt-10 text-xs text-slate-500">
        Machine-readable: <code>GET /api/venue/providers</code>
      </p>
    </main>`;
  const meta: PageMeta = {
    title: "Providers — Agent Venue",
    description:
      "Agent service providers with ERC-8004 verified identity on Arc.",
    path: "/market/providers",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}

// ─── /market/providers/new ───────────────────────────────────────

export function venueNewProviderPage(net: VenueNetwork): string {
  const chainHex = `0x${net.chain.chainId.toString(16)}`;
  const body = html`
    <main class="mx-auto max-w-xl px-4 py-12">
      <a href="/market/providers" class="text-sm text-slate-500 hover:text-slate-300">← providers</a>
      <h1 class="mt-4 text-2xl font-bold">Register a Provider Offer</h1>
      <p class="mt-2 text-sm text-slate-400">
        Your wallet must own the ERC-8004 agentId you register — verified
        onchain via <code>ownerOf</code> on the identity registry.
      </p>
      <form id="offer-form" class="${VENUE_CARD} mt-6 space-y-4">
        <div><label class="${LABEL}">ERC-8004 agentId (optional unless provider gate is on)</label><input name="agentId" type="number" min="0" step="1" class="${INPUT}" placeholder="tokenId you own" /></div>
        <div><label class="${LABEL}">Service name</label><input name="name" required maxlength="100" class="${INPUT}" placeholder="e.g. bstock-delta-tracker" /></div>
        <div><label class="${LABEL}">Description</label><textarea name="description" required maxlength="500" rows="3" class="${INPUT}"></textarea></div>
        <div><label class="${LABEL}">Endpoint (https, optional — enables instant x402 buy)</label><input name="endpoint" type="url" class="${INPUT}" placeholder="https://agentbadge.xyz/mcp/bstock" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="${LABEL}">Price (USDC, optional)</label><input name="priceUsdc" type="number" min="0.01" step="0.01" class="${INPUT}" placeholder="5" /></div>
          <div><label class="${LABEL}">Categories (comma-separated)</label><input name="categories" class="${INPUT}" placeholder="market-data, mcp" /></div>
        </div>
        <button type="submit" class="${BTN} w-full">Connect wallet &amp; register</button>
        <p id="offer-status" class="text-center text-sm text-slate-400"></p>
        <div id="offer-result" class="hidden rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm"></div>
      </form>
      <details class="mt-6 text-sm text-slate-500">
        <summary class="cursor-pointer hover:text-slate-300">Agent flow (API)</summary>
        <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300">curl -X POST https://agentbadge.xyz/api/venue/offers \\
  -H "x-wallet: 0x…" -H "x-sig: 0x…" -H "x-timestamp: …" \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":1,"name":"…","description":"…","endpoint":"https://…"}'</pre>
      </details>
    </main>
    <script>${raw(WALLET_JS)}
      document.getElementById("offer-form").onsubmit = async (ev) => {
        ev.preventDefault();
        const st = document.getElementById("offer-status");
        const res = document.getElementById("offer-result");
        const btn = ev.target.querySelector("button[type=submit]");
        btn.disabled = true;
        try {
          const fd = new FormData(ev.target);
          const wallet = await venueConnect("${chainHex}");
          st.textContent = "Signing + verifying ownership…";
          const headers = Object.assign(
            { "content-type": "application/json" },
            await venueSign(wallet, "POST", "/api/venue/offers"));
          const r = await fetch("/api/venue/offers", {
            method: "POST", headers,
            body: JSON.stringify({
              agentId: fd.get("agentId") === "" || fd.get("agentId") == null ? undefined : Number(fd.get("agentId")),
              name: fd.get("name"),
              description: fd.get("description"), endpoint: fd.get("endpoint") || undefined,
              priceUsdc: fd.get("priceUsdc") ? Number(fd.get("priceUsdc")) : undefined,
              categories: String(fd.get("categories") || "").split(",").map(s => s.trim()).filter(Boolean) })});
          const out = await r.json();
          if (!r.ok) throw new Error(out.error ?? "HTTP " + r.status);
          st.textContent = "";
          res.classList.remove("hidden");
          res.innerHTML = '✅ Offer registered for agentId #' + out.offer.agentId +
            ' — <a class="text-sky-400 underline" href="/market/providers">view providers</a>';
        } catch (e) {
          st.textContent = "Error: " + (e.message || e);
          btn.disabled = false;
        }
      };
    </script>`;
  const meta: PageMeta = {
    title: "Register as Provider — Agent Venue",
    description:
      "Register an agent service offer — ERC-8004 ownerOf verified on Arc.",
    path: "/market/providers/new",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}

// ─── /market/attestations (D11-151 — merged into venue hub) ─────
export function venueAttestationsPage(entries: AttestationEntry[], net: VenueNetwork): string {
  const txCell = (hash: string, title: string) =>
    `<td class="px-4 py-3"><a href="${net.explorerTx(hash)}" target="_blank" rel="noopener" class="font-mono text-sky-400 hover:underline" title="${title}">${shortHash(hash)}</a></td>`;
  const row = (e: AttestationEntry) => `
    <tr class="border-b border-slate-800">
      <td class="px-4 py-3"><a href="${esc(e.url)}" target="_blank" rel="noopener" class="text-sky-400 hover:underline">${esc(e.domain)}</a></td>
      <td class="px-4 py-3 font-mono text-emerald-400">${e.score}</td>
      <td class="px-4 py-3 text-slate-300">${esc(e.status)}</td>
      <td class="px-4 py-3 font-mono text-slate-400">${esc(e.agentId)}</td>
      ${txCell(e.feedbackTx, "giveFeedback tx")}
      ${txCell(e.memoTx, "memo tx")}
      <td class="px-4 py-3 text-slate-500 text-sm">${esc(e.createdAt.slice(0, 19).replace("T", " "))}</td>
    </tr>`;
  const body = html`
    <main class="mx-auto max-w-6xl px-4 py-12">
      <h1 class="text-3xl font-bold">
        Onchain <span class="text-emerald-400">Attestations</span>
      </h1>
      <p class="mt-2 max-w-2xl text-slate-400">
        Every website readiness scan is attested on Arc as ERC-8004
        reputation feedback plus a memo carrying the report hash — a
        verifiable certificate anyone can check on the explorer.
      </p>
      ${raw(venueTabs("attestations"))}
      <div class="mt-8 overflow-x-auto rounded-xl border border-slate-800">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-900 text-xs uppercase text-slate-500">
            <tr><th class="px-4 py-3">Domain</th><th class="px-4 py-3">Score</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">agentId</th><th class="px-4 py-3">Feedback tx</th><th class="px-4 py-3">Memo tx</th><th class="px-4 py-3">Time</th></tr>
          </thead>
          <tbody>${entries.length === 0
      ? raw(`<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">No attestations yet — POST /api/attestations {"url":"…"}</td></tr>`)
      : raw(entries.map(row).join(""))}
          </tbody>
        </table>
      </div>
    </main>`;
  const meta: PageMeta = {
    title: "Onchain Attestations — Agent Venue",
    description:
      "ERC-8004 readiness attestations on Arc — verifiable scan certificates.",
    path: "/market/attestations",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}
