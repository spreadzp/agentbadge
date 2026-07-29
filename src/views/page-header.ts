import { html } from "hono/html";

/**
 * Reusable page header block — badge, title, description.
 * Matches the dashboard hero section style.
 */
export function PageHeader({
  badge,
  title,
  description,
}: {
  badge: string;
  title: string;
  description: string;
}) {
  return html`<section
    class="mb-8 rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8"
  >
    <span
      class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300"
      >${badge}</span
    >
    <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">${title}</h1>
    <p class="mt-3 max-w-2xl text-slate-300">${description}</p>
  </section>`;
}
