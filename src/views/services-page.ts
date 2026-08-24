import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { RegistryIndex } from "../server/registry/types";
import { breadcrumbListLd } from "../server/lib/json-ld";

export function ServicesPage(registry: RegistryIndex) {
  const serviceCards = registry.services
    .map(
      (s) => `<div id="${s.id}" class="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
        <h3 class="text-lg font-semibold text-emerald-400">${s.name}</h3>
        <div class="mt-3">
          <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Problem</p>
          <p class="mt-1 text-sm text-slate-300">${s.problem}</p>
        </div>
        <div class="mt-4">
          <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Deliverables</p>
          <ul class="mt-1 list-disc pl-5 text-sm text-slate-300">
            ${s.deliverables.map((d) => `<li>${d}</li>`).join("")}
          </ul>
        </div>
        <div class="mt-4">
          <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Engagement</p>
          <div class="mt-1 flex flex-wrap gap-2">
            ${s.engagement.map((e) => `<span class="text-xs rounded-full bg-slate-700 px-2 py-1 text-slate-300">${e}</span>`).join("")}
          </div>
        </div>
        <div class="mt-4">
          <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Contact</p>
          <p class="mt-1 text-sm text-slate-400">${s.contact}</p>
        </div>
      </div>`,
    )
    .join("");

  const breadcrumbJsonLd = JSON.stringify(breadcrumbListLd([
    { name: "Home", path: "/" },
    { name: "Services", path: "/services" },
  ]));

  const content = html`
    <nav class="px-4 py-3 text-sm text-slate-400 md:px-8" aria-label="Breadcrumb">
      <ol class="flex items-center gap-2">
        <li><a href="/" class="hover:text-emerald-400">Home</a></li>
        <li class="text-slate-600">/</li>
        <li class="text-slate-300">Services</li>
      </ol>
    </nav>
    <script type="application/ld+json">${raw(breadcrumbJsonLd)}</script>
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Services</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Services Catalog</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        Engineering services offered by the AgentBadge team. Each service includes the problem we solve,
        what we deliver, and how you can engage with us.
      </p>
    </section>

    <div class="mt-8 grid gap-4 sm:grid-cols-2">
      ${raw(serviceCards)}
    </div>

    <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
      <p class="text-slate-300">Ready to start?</p>
      <p class="mt-2 text-sm text-slate-400">
        <a href="/work-with-us" class="text-emerald-400 underline hover:text-emerald-300">See engagement options</a>
        or <a href="/agent-guide/team/contact" class="text-emerald-400 underline hover:text-emerald-300">contact us</a>.
      </p>
    </section>
  `;

  return Layout(content.toString(), "Services — AgentBadge", {
    title: "Services — AgentBadge",
    description:
      "AgentBadge engineering services — MCP server development, blockchain integration, AI agent architecture, GEO optimization. Contract, part-time, and fixed-scope.",
    path: "/services",
  });
}
