/**
 * SLICE-153-7: self-serve business-venue onboarding.
 *
 * /market/venues/new — wallet-signed create form → POST /api/venue/instances.
 * Business venues are created active on a free trial
 * (ARC_BV_FREE_TRIAL_DAYS, default 14) and bill via 153-5 subscription.
 */
import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type { VenueNetwork } from "../server/lib/venue/chain";
import { VENUE_CARD, WALLET_JS } from "./venue-ui";

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none";
const BTN =
  "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50";
const LABEL = "block text-xs font-medium text-slate-400 mb-1";

export function venueNewVenuePage(net: VenueNetwork, trialDays: number): string {
  const chainHex = `0x${net.chain.chainId.toString(16)}`;
  const body = html`
    <main class="mx-auto max-w-xl px-4 py-12">
      <a href="/market" class="text-sm text-slate-500 hover:text-slate-300">← market hub</a>
      <h1 class="mt-4 text-2xl font-bold">Create a Business Venue</h1>
      <p class="mt-2 text-sm text-slate-400">
        Your own gated marketplace on Arc ${net.name}: member-only jobs,
        private details off-chain, your evaluator policy and take rate.
        ${trialDays > 0 ? `Free trial: <b class="text-emerald-400">${trialDays} days</b>, then monthly subscription.` : ""}
      </p>
      <form id="venue-form" class="${VENUE_CARD} mt-6 space-y-4">
        <div><label class="${LABEL}">Venue name</label><input name="name" required maxlength="120" class="${INPUT}" placeholder="e.g. Acme Ops" /></div>
        <div><label class="${LABEL}">Slug (url-safe, unique)</label><input name="slug" required maxlength="64" pattern="[a-z0-9][a-z0-9-]+" class="${INPUT}" placeholder="acme-ops" /></div>
        <div><label class="${LABEL}">Description</label><textarea name="description" maxlength="500" rows="3" class="${INPUT}" placeholder="What happens in this venue"></textarea></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="${LABEL}">Who can post jobs</label>
            <select name="clientPolicy" class="${INPUT}">
              <option value="members">members only</option>
              <option value="open">open</option>
            </select></div>
          <div><label class="${LABEL}">Evaluator policy</label>
            <select name="evaluator" class="${INPUT}">
              <option value="server">platform server (default)</option>
              <option value="owner">venue owner wallet</option>
            </select></div>
        </div>
        <div><label class="${LABEL}">Take rate bps (optional override, 0–10000)</label><input name="takeRateBps" type="number" min="0" max="10000" step="1" class="${INPUT}" placeholder="leave empty for default" /></div>
        <button type="submit" class="${BTN} w-full">Connect wallet &amp; create venue</button>
        <p id="venue-status" class="text-center text-sm text-slate-400"></p>
        <div id="venue-result" class="hidden rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm"></div>
      </form>
      <details class="mt-6 text-sm text-slate-500">
        <summary class="cursor-pointer hover:text-slate-300">Agent flow (API)</summary>
        <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300">curl -X POST https://agentbadge.xyz/api/venue/instances \\
  -H "x-wallet: 0x…" -H "x-sig: 0x…" -H "x-timestamp: …" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Acme Ops","slug":"acme-ops","clientPolicy":"members"}'</pre>
      </details>
    </main>
    <script>${raw(WALLET_JS)}
      document.getElementById("venue-form").onsubmit = async (ev) => {
        ev.preventDefault();
        const st = document.getElementById("venue-status");
        const res = document.getElementById("venue-result");
        const btn = ev.target.querySelector("button[type=submit]");
        btn.disabled = true;
        try {
          const fd = new FormData(ev.target);
          const wallet = await venueConnect("${chainHex}");
          st.textContent = "Signing venue record…";
          const headers = Object.assign(
            { "content-type": "application/json" },
            await venueSign(wallet, "POST", "/api/venue/instances"));
          const r = await fetch("/api/venue/instances", {
            method: "POST", headers,
            body: JSON.stringify({
              name: fd.get("name"), slug: fd.get("slug"),
              description: fd.get("description") || undefined,
              clientPolicy: fd.get("clientPolicy"),
              evaluator: fd.get("evaluator"),
              takeRateBps: fd.get("takeRateBps")
                ? Number(fd.get("takeRateBps")) : undefined })});
          const out = await r.json();
          if (!r.ok) throw new Error((out.error && out.error.message) || out.error || "HTTP " + r.status);
          st.textContent = "";
          res.classList.remove("hidden");
          res.innerHTML = "✅ Venue created" + (out.trial ? " — trial active" : "") +
            ' — <a class="text-emerald-400 underline" href="/market/v/' + out.venue.slug + '">open venue</a>' +
            ' · <a class="text-sky-400 underline" href="/market/v/' + out.venue.slug + '/admin">admin console →</a>';
        } catch (e) {
          st.textContent = "Error: " + (e.message || e);
          btn.disabled = false;
        }
      };
    </script>`;
  const meta: PageMeta = {
    title: "Create a Business Venue — Agent Venue",
    description:
      "Self-serve business venue on Arc: member-only jobs, private details, evaluator policy — free trial, USDC subscription.",
    path: "/market/venues/new",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}
