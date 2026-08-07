import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { RegistryIndex } from "../server/registry/types";

export function TeamPage(registry: RegistryIndex) {
  const capCards = registry.capabilities
    .map(
      (cap) => `<div class="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-emerald-400">${cap.name}</h3>
          <span class="text-xs text-slate-400">Confidence: ${cap.confidence}</span>
        </div>
        <p class="mt-1 text-xs text-slate-400">${cap.description ?? ""}</p>
        <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
          <span>Status: ${cap.status}</span>
          <span>Skills: ${cap.skills.length}</span>
        </div>
      </div>`,
    )
    .join("");

  const peopleCards = registry.people
    .map(
      (p) => `<div class="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <h3 class="text-sm font-semibold text-white">${p.name}</h3>
        <p class="mt-1 text-xs text-slate-400">Roles: ${p.roles.join(", ")}</p>
        <p class="mt-1 text-xs text-slate-500">Availability: <span class="${p.availability === "available" ? "text-emerald-400" : "text-amber-400"}">${p.availability}</span></p>
      </div>`,
    )
    .join("");

  const serviceList = registry.services
    .map(
      (s) => `<li class="text-sm text-slate-300">
        <a href="/services#${s.id}" class="text-emerald-400 hover:text-emerald-300 underline">${s.name}</a>
      </li>`,
    )
    .join("");

  const content = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Team</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Engineering Team</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        We build agent-native infrastructure on Hedera — MCP servers, blockchain integrations, AI agent architectures,
        and GEO optimization. Available for contract, part-time, and fixed-scope engagements.
      </p>
    </section>

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">Capabilities</h2>
      <p class="mt-1 text-sm text-slate-400">What we can do — verified with evidence and confidence scores.</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        ${raw(capCards)}
      </div>
    </section>

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">Services</h2>
      <p class="mt-1 text-sm text-slate-400">What we offer — with deliverables and engagement models.</p>
      <ul class="mt-3 space-y-1">
        ${raw(serviceList)}
      </ul>
    </section>

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">People</h2>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        ${raw(peopleCards)}
      </div>
    </section>

    <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
      <p class="text-slate-300">Want to work with us?</p>
      <p class="mt-2 text-sm text-slate-400">
        <a href="/work-with-us" class="text-emerald-400 underline hover:text-emerald-300">See engagement options</a>
        or <a href="/agent-guide/team/contact" class="text-emerald-400 underline hover:text-emerald-300">contact us directly</a>.
      </p>
    </section>
  `;

  return Layout(content.toString(), "Team — AgentBadge", {
    title: "Team — AgentBadge",
    description:
      "AgentBadge engineering team — MCP development, blockchain integration, AI agent architecture, and GEO optimization. Available for contract work.",
    path: "/team",
  });
}
