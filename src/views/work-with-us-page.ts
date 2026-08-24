import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { RegistryIndex } from "../server/registry/types";

export function WorkWithUsPage(registry: RegistryIndex) {
  const engagementTypes = [
    {
      name: "Contract",
      description: "Full-time engagement for a defined period. Best for projects that need dedicated focus.",
      icon: "📋",
    },
    {
      name: "Part-time",
      description: "Ongoing involvement a few hours per week. Best for advisory or incremental work.",
      icon: "⏱️",
    },
    {
      name: "Fixed-scope",
      description: "Defined deliverables with a fixed price. Best for well-specified projects.",
      icon: "🎯",
    },
  ];

  const engagementHtml = engagementTypes
    .map(
      (e) => `<div class="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <div class="text-2xl">${e.icon}</div>
        <h3 class="mt-2 text-sm font-semibold text-emerald-400">${e.name}</h3>
        <p class="mt-1 text-xs text-slate-400">${e.description}</p>
      </div>`,
    )
    .join("");

  const availabilityHtml = registry.people
    .map(
      (p) => `<div class="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3">
        <span class="text-sm text-slate-300">${p.name}</span>
        <span class="text-xs ${p.availability === "available" ? "text-emerald-400" : "text-amber-400"}">${p.availability}</span>
      </div>`,
    )
    .join("");

  const contactChannels = registry.people[0]?.contact.channels ?? ["telegram", "email"];
  const channelsHtml = contactChannels
    .map(
      (ch) => `<span class="text-xs rounded-full bg-slate-700 px-3 py-1 text-slate-300 capitalize">${ch}</span>`,
    )
    .join("");

  const content = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Work With Us</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Work With the AgentBadge Team</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        We help companies build agent-native infrastructure on Hedera — from MCP servers to full AI agent
        architectures. Here's how to engage with us.
      </p>
    </section>

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">Engagement Types</h2>
      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        ${raw(engagementHtml)}
      </div>
    </section>

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">Process</h2>
      <ol class="mt-3 list-decimal pl-5 space-y-2 text-sm text-slate-300">
        <li><strong>Initial call</strong> — We discuss your project, timeline, and budget.</li>
        <li><strong>Scope definition</strong> — We write a brief with deliverables and milestones.</li>
        <li><strong>Engagement</strong> — We start work. Weekly demos for contract, milestone-based for fixed-scope.</li>
        <li><strong>Delivery</strong> — Code, docs, and handoff. 30-day support included.</li>
      </ol>
    </section>

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">Availability</h2>
      <div class="mt-3 space-y-2">
        ${raw(availabilityHtml)}
      </div>
    </section>

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">Contact</h2>
      <p class="mt-2 text-sm text-slate-400">Reach us through any of these channels:</p>
      <div class="mt-3 flex flex-wrap gap-2">
        ${raw(channelsHtml)}
      </div>
      <p class="mt-4 text-sm text-slate-400">
        Or read our <a href="/agent-guide/team/capabilities" class="text-emerald-400 underline hover:text-emerald-300">full capabilities</a>
        and <a href="/services" class="text-emerald-400 underline hover:text-emerald-300">services catalog</a>.
      </p>
    </section>
  `;

  return Layout(content.toString(), "Work With Us", {
    title: "Work With Us",
    description:
      "Engage with the AgentBadge engineering team — contract, part-time, or fixed-scope. MCP development, blockchain integration, AI agent architecture, GEO optimization.",
    path: "/work-with-us",
  });
}
