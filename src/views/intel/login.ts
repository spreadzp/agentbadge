// EPIC-262 (SLICE-262-10): operator login — abop_ key → session
// cookie. Honest copy: the key IS the credential; revocation logs
// the session out immediately.
import { html } from "hono/html";

export const IntelLoginPage = (error?: string) => html`
  <div class="mx-auto max-w-md py-16">
    <h1 class="text-2xl font-bold text-white">Agent Surface Intel</h1>
    <p class="mt-2 text-sm text-slate-400">Operator sign-in — paste your <span class="font-mono">abop_</span> key.</p>
    ${error ? html`<p class="mt-4 rounded-lg bg-rose-500/15 px-4 py-3 text-sm text-rose-300">${error}</p>` : ""}
    <form method="post" action="/intel/login" class="mt-6 space-y-4">
      <label class="block">
        <span class="text-xs text-slate-500">Operator key</span>
        <input name="key" type="password" required autocomplete="off"
          class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
          placeholder="abop_…" />
      </label>
      <button type="submit" class="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400">Sign in</button>
    </form>
    <p class="mt-6 text-xs text-slate-600">Keys are issued per-tenant by the owner. A revoked key ends the session immediately.</p>
  </div>
`;
