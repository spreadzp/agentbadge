/**
 * SLICE-153-4: venue admin console — /market/v/:slug/admin.
 *
 * Owner/delegate self-serve: PATCH /api/venue/instances/:id (name, desc,
 * policies, branding), members add/revoke, delegates manage, stats +
 * audit trail. All mutating calls go through venueSign (wallet-sig).
 */
import { html, raw } from "hono/html";

import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type { VenueNetwork } from "../server/lib/venue/chain";
import type {
  AdminAuditEntry,
  VenueRecord,
} from "../server/lib/venue/venues";
import {
  subscriptionStatus,
  type VenuePayment,
} from "../server/lib/venue/billing";
import type { VenueMember } from "../server/lib/venue/members";
import type { VenueJob } from "../server/lib/venue/store";
import {
  CARD,
  esc,
  shortAddr,
  venueSelector,
  WALLET_JS,
} from "./venue-ui";

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none";
const BTN =
  "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50";
const LABEL = "block text-xs font-medium text-slate-400 mb-1";
const CHIP =
  "rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-emerald-500 hover:text-slate-200";

const fmtVal = (v: unknown): string => {
  if (v === undefined) return "—";
  if (typeof v === "object" && v !== null) {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  }
  return String(v);
};

export function venueAdminPage(
  venue: VenueRecord,
  members: VenueMember[],
  jobs: VenueJob[],
  audit: AdminAuditEntry[],
  venues: VenueRecord[],
  net: VenueNetwork,
  serverEvaluator: string,
  payments: VenuePayment[] = [],
  monthlyPriceAtomic = "0",
): string {
  const chainHex = `0x${net.chain.chainId.toString(16)}`;
  const byStatus: Record<string, number> = {};
  let volume = 0;
  for (const j of jobs) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    volume += j.budgetUsdc;
  }
  const ev = venue.policies?.evaluator ?? "server";
  const evSel = ev === "server" || ev === "owner" ? ev : "custom";
  const evCustom = ev.startsWith("custom:") ? ev.slice(7) : "";
  const br = venue.policies?.branding ?? {};

  const memberRow = (m: VenueMember) => html`
    <div class="flex items-center justify-between gap-3 border-b border-slate-800 py-2 last:border-0">
      <div class="min-w-0">
        <span class="font-mono text-xs text-slate-200">${esc(shortAddr(m.wallet))}</span>
        <span class="ml-2 text-xs text-slate-500">${esc(m.role)}</span>
        ${m.revoked ? html`<span class="ml-2 text-xs text-red-400">revoked</span>` : ""}
      </div>
      ${m.role !== "owner" && !m.revoked
        ? html`<button data-revoke="${esc(m.wallet)}" class="text-xs text-red-400 hover:text-red-300">revoke</button>`
        : ""}
    </div>`;

  const auditRow = (a: AdminAuditEntry) => html`
    <div class="border-b border-slate-800 py-2 last:border-0 text-xs">
      <span class="text-slate-500">${esc(new Date(a.ts).toISOString().slice(0, 19).replace("T", " "))}</span>
      <span class="mx-2 font-mono text-slate-400">${esc(shortAddr(a.actor))}</span>
      <span class="text-slate-300">${esc(a.field)}</span>:
      <span class="text-red-400/80">${esc(fmtVal(a.old))}</span> →
      <span class="text-emerald-400/80">${esc(fmtVal(a.new))}</span>
    </div>`;

  const meta: PageMeta = {
    title: `${venue.name} — Admin`,
    description: `Admin console for venue "${venue.slug}".`,
    path: `/market/v/${venue.slug}/admin`,
  };
  const body = html`
    <main class="mx-auto max-w-3xl px-4 py-12">
      <a href="/market/v/${esc(venue.slug)}" class="text-sm text-slate-500 hover:text-slate-300">← ${esc(venue.name)}</a>
      <div class="mt-3 flex items-center gap-3">
        <h1 class="text-2xl font-bold">Admin console</h1>
        <span class="rounded-full border border-violet-500/50 bg-violet-500/10 px-2.5 py-0.5 text-xs text-violet-300">${esc(venue.slug)}</span>
      </div>
      ${raw(venueSelector(venues, venue.slug))}
      <nav class="mt-6 flex flex-wrap gap-2">
        <a href="#general" class="${CHIP}">General</a>
        <a href="#policies" class="${CHIP}">Policies</a>
        <a href="#members" class="${CHIP}">Members</a>
        <a href="#stats" class="${CHIP}">Stats</a>
        <a href="#audit" class="${CHIP}">Audit</a>
        <a href="#billing" class="${CHIP}">Billing</a>
      </nav>
      <p id="adm-status" class="mt-4 text-center text-sm text-slate-400"></p>

      ${(() => {
        // 153-7: welcome checklist — drives the tenant to a full cycle.
        const checks: [string, boolean][] = [
          ["Venue created", true],
          ["Add members", members.some((m) => !m.revoked && m.role !== "owner")],
          ["Post first job", jobs.length > 0],
          ["Complete a cycle", jobs.some((j) => j.status === "completed")],
        ];
        if (checks.every(([, ok]) => ok)) return "";
        return html`<section class="${CARD} mt-6">
          <h2 class="text-sm font-semibold text-slate-200">Onboarding checklist</h2>
          <ul class="mt-2 space-y-1 text-sm">
            ${raw(checks.map(([label, ok]) =>
              `<li class="${ok ? "text-emerald-400" : "text-slate-400"}">${ok ? "✓" : "○"} ${esc(label)}</li>`).join(""))}
          </ul>
        </section>`;
      })()}

      <section id="general" class="${CARD} mt-6 space-y-4">
        <h2 class="text-sm font-semibold text-slate-200">General</h2>
        <div><label class="${LABEL}">Name</label><input id="f-name" class="${INPUT}" value="${esc(venue.name)}" maxlength="120" /></div>
        <div><label class="${LABEL}">Description</label><textarea id="f-desc" class="${INPUT}" rows="3" maxlength="500">${esc(venue.description ?? "")}</textarea></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="${LABEL}">Brand title</label><input id="f-btitle" class="${INPUT}" value="${esc(br.title ?? "")}" maxlength="120" /></div>
          <div><label class="${LABEL}">Brand color</label><input id="f-bcolor" class="${INPUT}" value="${esc(br.color ?? "")}" maxlength="32" placeholder="#10b981" /></div>
          <div><label class="${LABEL}">Logo URL</label><input id="f-blogo" class="${INPUT}" value="${esc(br.logoUrl ?? "")}" maxlength="500" placeholder="https://…" /></div>
        </div>
        <button id="save-general" class="${BTN}">Sign &amp; save</button>
      </section>

      <section id="policies" class="${CARD} mt-6 space-y-4">
        <h2 class="text-sm font-semibold text-slate-200">Policies</h2>
        <div>
          <label class="${LABEL}">Evaluator</label>
          <select id="f-evaluator" class="${INPUT}">
            <option value="server" ${evSel === "server" ? "selected" : ""}>server — ${esc(shortAddr(serverEvaluator))} (platform evaluator)</option>
            <option value="owner" ${evSel === "owner" ? "selected" : ""}>owner — ${esc(shortAddr(venue.ownerWallet))}</option>
            <option value="custom" ${evSel === "custom" ? "selected" : ""}>custom address…</option>
          </select>
          <input id="f-evaluator-custom" class="${INPUT} mt-2 ${evSel === "custom" ? "" : "hidden"}" value="${esc(evCustom)}" placeholder="0x…" maxlength="42" />
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="${LABEL}">Client policy</label>
            <select id="f-clientPolicy" class="${INPUT}">
              <option value="members" ${(venue.clientPolicy ?? "members") === "members" ? "selected" : ""}>members</option>
              <option value="open" ${venue.clientPolicy === "open" ? "selected" : ""}>open</option>
            </select></div>
          <div><label class="${LABEL}">Required pass class (0–7)</label><input id="f-requiredClass" type="number" min="0" max="7" class="${INPUT}" value="${venue.requiredClass ?? 0}" /></div>
          <div><label class="${LABEL}">Take rate (bps, 153-5)</label><input id="f-takeRate" type="number" min="0" max="10000" class="${INPUT}" value="${venue.policies?.takeRateBps ?? ""}" /></div>
        </div>
        <button id="save-policies" class="${BTN}">Sign &amp; save</button>
      </section>

      <section id="members" class="${CARD} mt-6">
        <h2 class="text-sm font-semibold text-slate-200">Members (${members.filter((m) => !m.revoked).length})</h2>
        <div class="mt-3">${raw(members.map(memberRow).join(""))}</div>
        <div class="mt-4 flex gap-2">
          <input id="f-member-wallet" class="${INPUT}" placeholder="0x… member wallet" maxlength="42" />
          <select id="f-member-role" class="${INPUT} w-36">
            <option value="viewer">viewer</option>
            <option value="provider">provider</option>
            <option value="admin">admin</option>
          </select>
          <button id="add-member" class="${BTN} shrink-0">Add</button>
        </div>
        <h3 class="mt-6 text-sm font-semibold text-slate-200">Delegate admins</h3>
        <p class="mt-1 text-xs text-slate-500">Delegates hold admin rights without a member row.</p>
        <div class="mt-2 space-y-1">
          ${raw(venue.delegates.map((d) => html`
            <div class="flex items-center justify-between text-xs">
              <span class="font-mono text-slate-300">${esc(d)}</span>
              <button data-deldelegate="${esc(d)}" class="text-red-400 hover:text-red-300">remove</button>
            </div>`).join("") || '<span class="text-xs text-slate-600">none</span>')}
        </div>
        <div class="mt-3 flex gap-2">
          <input id="f-delegate" class="${INPUT}" placeholder="0x… delegate wallet" maxlength="42" />
          <button id="add-delegate" class="${BTN} shrink-0">Add delegate</button>
        </div>
      </section>

      <section id="stats" class="${CARD} mt-6">
        <h2 class="text-sm font-semibold text-slate-200">Stats</h2>
        <div class="mt-3 grid grid-cols-3 gap-4 text-sm">
          <div><span class="text-slate-500">Jobs</span><div class="text-lg font-semibold text-slate-100">${jobs.length}</div></div>
          <div><span class="text-slate-500">Volume</span><div class="text-lg font-semibold text-emerald-400">$${volume.toFixed(2)}</div></div>
          <div><span class="text-slate-500">Members</span><div class="text-lg font-semibold text-slate-100">${members.filter((m) => !m.revoked).length}</div></div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${raw(Object.entries(byStatus).map(([s, n]) =>
            `<span class="${CHIP}">${esc(s)}: ${n}</span>`).join("") ||
            '<span class="text-xs text-slate-600">no jobs yet</span>')}
        </div>
      </section>

      <section id="audit" class="${CARD} mt-6">
        <h2 class="text-sm font-semibold text-slate-200">Audit trail</h2>
        <div class="mt-3">${raw(audit.slice(-50).reverse().map(auditRow).join("") ||
          '<span class="text-xs text-slate-600">no admin changes yet</span>')}</div>
      </section>

      <section id="billing" class="${CARD} mt-6">
        <h2 class="text-sm font-semibold text-slate-200">Billing</h2>
        ${(() => {
          const st = subscriptionStatus(venue);
          const exp = venue.subscription?.expiresAt;
          const badge = st === "active"
            ? '<span class="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300">active</span>'
            : st === "grace"
              ? '<span class="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300">grace</span>'
              : st === "expired"
                ? '<span class="rounded-full border border-red-500/50 bg-red-500/10 px-2.5 py-0.5 text-xs text-red-300">expired</span>'
                : '<span class="rounded-full border border-slate-600 px-2.5 py-0.5 text-xs text-slate-400">unsubscribed</span>';
          return html`
        <div class="mt-3 flex items-center gap-3">
          ${raw(badge)}
          ${exp ? html`<span class="text-sm text-slate-400">expires ${esc(new Date(exp * 1000).toISOString().slice(0, 10))}</span>` : ""}
          ${venue.subscription?.lastPaymentTx
            ? html`<a class="text-xs text-slate-500 underline" href="${esc(net.explorerTx(venue.subscription.lastPaymentTx))}" target="_blank" rel="noopener">last payment tx</a>` : ""}
        </div>
        <div class="mt-4 flex items-center gap-2">
          <input id="f-sub-months" type="number" min="1" max="24" value="1" class="${INPUT} w-24" />
          <button id="renew-sub" class="${BTN}">Renew subscription ($${(Number(monthlyPriceAtomic) / 1e6).toFixed(2)}/mo)</button>
        </div>
        ${st === "expired" || st === "grace"
          ? html`<p class="mt-2 text-xs ${st === "expired" ? "text-red-400" : "text-amber-400"}">
            ${st === "expired"
              ? "Subscription lapsed — new jobs are blocked (402) until renewal. Lifecycle ops keep working."
              : "Grace period — renew soon to keep posting jobs at the subscriber take rate."}
          </p>` : ""}
        <h3 class="mt-5 text-sm font-semibold text-slate-200">Payments</h3>
        <div class="mt-2">
          ${raw(payments.slice(-20).reverse().map((p) => html`
            <div class="border-b border-slate-800 py-1.5 text-xs last:border-0">
              <span class="text-slate-500">${esc(new Date(p.ts).toISOString().slice(0, 10))}</span>
              <span class="mx-2 text-emerald-400">$${(Number(BigInt(p.amountAtomic)) / 1e6).toFixed(2)}</span>
              <span class="text-slate-400">+${Math.round(p.durationSec / 86400)}d</span>
              ${p.tx ? html`<a class="ml-2 font-mono text-slate-500 underline" href="${esc(net.explorerTx(p.tx as `0x${string}`))}" target="_blank" rel="noopener">${esc(p.tx.slice(0, 10))}…</a>` : ""}
            </div>`).join("") || '<span class="text-xs text-slate-600">no payments yet</span>')}
        </div>`;
        })()}
      </section>
    </main>
    <script>${raw(WALLET_JS)}
      const VID = "${esc(venue.id)}";
      const st = document.getElementById("adm-status");
      async function call(method, path, body) {
        const wallet = await venueConnect("${chainHex}");
        const headers = Object.assign({ "content-type": "application/json" },
          await venueSign(wallet, method, path));
        const r = await fetch(path, { method, headers,
          body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw new Error((await r.json()).error ?? "HTTP " + r.status);
        return r.json();
      }
      function val(id) { const el = document.getElementById(id); return el ? el.value : ""; }
      async function run(fn) { st.textContent = "Sign &amp; send…"; try { await fn(); st.textContent = "Saved — reloading"; location.reload(); } catch (e) { st.textContent = String(e.message || e); } }
      document.getElementById("save-general").onclick = () => run(() => call("PATCH", "/api/venue/instances/" + VID, {
        name: val("f-name"), description: val("f-desc") || null,
        policies: { branding: { title: val("f-btitle") || undefined,
          color: val("f-bcolor") || undefined, logoUrl: val("f-blogo") || undefined } } }));
      document.getElementById("save-policies").onclick = () => run(() => {
        const ev = val("f-evaluator");
        const evaluator = ev === "custom" ? "custom:" + val("f-evaluator-custom") : ev;
        const tr = val("f-takeRate");
        return call("PATCH", "/api/venue/instances/" + VID, {
          clientPolicy: val("f-clientPolicy"),
          requiredClass: Number(val("f-requiredClass")),
          policies: { evaluator, ...(tr ? { takeRateBps: Number(tr) } : {}) } });
      });
      document.getElementById("f-evaluator").onchange = (ev) =>
        document.getElementById("f-evaluator-custom").classList.toggle("hidden", ev.target.value !== "custom");
      document.getElementById("add-member").onclick = () => run(() =>
        call("POST", "/api/venue/instances/" + VID + "/members",
          { wallet: val("f-member-wallet"), role: val("f-member-role") }));
      for (const b of document.querySelectorAll("[data-revoke]"))
        b.onclick = () => run(() => call("DELETE",
          "/api/venue/instances/" + VID + "/members/" + b.dataset.revoke));
      document.getElementById("add-delegate").onclick = () => run(() =>
        call("POST", "/api/venue/instances/" + VID + "/delegates",
          { add: val("f-delegate") }));
      for (const b of document.querySelectorAll("[data-deldelegate]"))
        b.onclick = () => run(() => call("POST",
          "/api/venue/instances/" + VID + "/delegates", { remove: b.dataset.deldelegate }));
      // 153-5: renew — direct-subscribe path (ARC_BV_DIRECT_SUBSCRIBE=1);
      // with x402 wiring the settle seam supplies payment instead.
      document.getElementById("renew-sub").onclick = () => run(() =>
        call("POST", "/api/venue/instances/" + VID + "/subscribe",
          { amountAtomic: String(BigInt("${monthlyPriceAtomic}") * BigInt(Math.max(1, Number(val("f-sub-months")) || 1))) }));
      // 153-7: signed audit export — manifest sha256 makes it self-verifying.
      async function exportAudit(format) {
        st.textContent = "Sign &amp; download…";
        try {
          const path = "/api/venue/instances/" + VID + "/export";
          const wallet = await venueConnect("${chainHex}");
          const headers = await venueSign(wallet, "GET", path);
          const r = await fetch(path + (format ? "?format=" + format : ""), { headers });
          if (!r.ok) throw new Error("HTTP " + r.status);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(await r.blob());
          a.download = "venue-" + VID + "-export." + (format === "csv" ? "csv" : "json");
          a.click();
          st.textContent = "Export downloaded";
        } catch (e) { st.textContent = String(e.message || e); }
      }
      document.getElementById("export-json").onclick = () => exportAudit("");
      document.getElementById("export-csv").onclick = () => exportAudit("csv");
    </script>`;
  return Layout(body as unknown as string, undefined, meta).toString();
}
