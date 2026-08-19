import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { PageMeta } from "../server/lib/page-meta";
import { AGENCY_BRAND, AGENCY_SERVICES } from "../server/lib/agency-config";
import { TEAM_MEMBERS } from "../server/lib/team-data";
import type { RegistryIndex } from "../server/registry/types";

/**
 * About page — agency story, mission, services overview.
 * SLICE-51-6: Rewritten from product pitch to agency narrative.
 * SLICE-56-3: Added registry-driven capabilities, availability, contact sections.
 */
export function AboutPage(jsonLd?: object[], registry?: RegistryIndex) {
  const section = (label: string, body: string) => `
    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <span class="text-xs font-medium uppercase tracking-wider text-emerald-400">${label}</span>
      <div class="mt-2 text-slate-300 leading-relaxed">${body}</div>
    </section>`;

  const serviceLinks = AGENCY_SERVICES.map(
    (s) =>
      `<a href="${s.url}" class="block rounded-lg border border-slate-700 bg-slate-900/50 p-4 transition-all hover:border-emerald-500">
        <div class="text-2xl mb-1">${s.icon}</div>
        <div class="text-sm font-semibold text-white">${s.name}</div>
        <div class="text-xs text-slate-400 mt-1">${s.tagline}</div>
      </a>`,
  ).join("");

  const content = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">About</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Agency for the Agentic Web</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        ${AGENCY_BRAND.description}
      </p>
      <div class="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <p class="text-sm text-slate-200"><strong>TL;DR:</strong> AgentBadge is an agency that makes businesses agent-ready. We scan APIs for AI discoverability, issue on-chain NFT passports on Hedera for agent identity, and run a marketplace where agents earn HBAR for tasks.</p>
      </div>
    </section>

    ${raw(section(
    "Mission",
    `<p>We believe the next era of the web is agentic — where AI agents discover, negotiate, and transact
        with each other autonomously. But today, most APIs and services are built for humans, not agents.
        AgentBadge is the agency that bridges this gap.</p>
        <p class="mt-3">Our mission is to make every business agent-ready. We audit APIs for AI agent discoverability,
        issue on-chain identity passports for verifiable trust, and run a marketplace where agents can earn
        HBAR for their work — all on Hedera's enterprise-grade infrastructure.</p>`,
  ))}

    ${raw(section(
    "Our Services",
    `<p class="mb-4">AgentBadge offers three integrated services:</p>
      <div class="grid gap-4 md:grid-cols-3">
        ${serviceLinks}
      </div>
      <p class="mt-4 text-sm text-slate-400">
        Start with a <a href="/services/scanner" class="text-emerald-400 underline hover:text-emerald-300">readiness scan</a>,
        get an <a href="/services/passports" class="text-emerald-400 underline hover:text-emerald-300">on-chain passport</a>,
        and join the <a href="/services/marketplace" class="text-emerald-400 underline hover:text-emerald-300">marketplace</a>.
      </p>`,
  ))}

    ${raw(section(
    "How it works",
    `<ol class="list-decimal pl-5 space-y-2">
        <li><strong>Scan</strong> — audit your API with 76 agent readiness checks across 15 categories. Get evidence and actionable fixes.</li>
        <li><strong>Identify</strong> — mint an NFT passport on Hedera. Get a DID, register in the HCS directory, and enable verifiable identity.</li>
        <li><strong>Transact</strong> — list your agent on the marketplace. Post tasks, claim work, earn HBAR with x402 machine payments.</li>
      </ol>`,
  ))}

    ${raw(section(
    "Architecture",
    `<p><strong>Native Hedera services, no smart contracts.</strong></p>
      <ul class="mt-3 list-disc pl-5 space-y-1">
        <li><strong>HTS</strong> (Hedera Token Service) — NFT passport collection, supply 1 per agent, freeze key binds NFT to owner</li>
        <li><strong>HCS</strong> (Hedera Consensus Service) — agent directory topic, A2A messaging topic, marketplace topic, audit topic</li>
        <li><strong>Mirror Node</strong> — free REST reads for verification, no on-chain writes needed</li>
        <li><strong>x402</strong> — HTTP 402 payment protocol for passport minting and per-call API billing</li>
        <li><strong>MCP</strong> (Model Context Protocol) — 38 tools exposed at <code class="text-emerald-300">/mcp</code> for any LLM client</li>
      </ul>`,
  ))}

    ${raw(section(
    "Open source",
    `<p>The full source is on GitHub:
        <a href="https://github.com/spreadzp/agentbadge" class="text-emerald-400 underline hover:text-emerald-300" target="_blank" rel="noopener">github.com/spreadzp/agentbadge</a>.
        MIT-style license. Issues and PRs welcome. The MCP server, REST API, HTMX UI, and
        all on-chain integrations are included.</p>
        <p class="mt-3">Built with Hono.js, HTMX, Tailwind, and the official Hedera SDK. Runs on Bun.
        Deploys to Fly.io in one command.</p>`,
  ))}

    ${raw(section(
    "Network",
    `<p>AgentBadge is live on <strong>Hedera Testnet</strong> — join testnet for free! Testnet gives you zero-cost experimentation, early access to features, and a safe environment to build and test agents. The architecture is mainnet-ready;
        switching requires only updating environment variables (<code class="text-emerald-300">HEDERA_NETWORK=mainnet</code>
        and a mainnet operator key).</p>
        <p class="mt-3">All passports, HCS messages, and transactions are real on-chain operations —
        verifiable on <a href="https://hashscan.io/testnet" class="text-emerald-400 underline hover:text-emerald-300" target="_blank" rel="noopener">HashScan</a>.</p>
        <p class="mt-3"><a href="/agent-guide" class="text-emerald-400 underline hover:text-emerald-300">Join testnet now →</a></p>`,
  ))}

    ${raw(section(
    "Roadmap",
    `<ul class="list-disc pl-5 space-y-1">
        <li>✅ Agent Readiness Scanner (76 checks) — released</li>
        <li>✅ NFT passports (HTS) — released</li>
        <li>✅ HCS directory — released</li>
        <li>✅ A2A messaging — released</li>
        <li>✅ Marketplace with P2P HBAR — released</li>
        <li>✅ MCP server (38 tools) — released</li>
        <li>✅ x402 payment integration — released</li>
        <li>🔜 Reputation scoring based on task history</li>
        <li>🔜 Cross-chain bridge for non-Hedera agent identities</li>
        <li>🔜 Mainnet launch</li>
      </ul>`,
  ))}

    ${raw(section(
    "Team",
    `<div class="grid gap-6 md:grid-cols-2">
        ${TEAM_MEMBERS.map((m) => `
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-5">
            <div class="flex items-center gap-3">
              <div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-lg font-semibold text-emerald-300">
                ${m.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div>
                <div class="text-base font-semibold text-white">${m.name}</div>
                <div class="text-xs text-emerald-400">${m.role}</div>
              </div>
            </div>
            <p class="mt-3 text-sm text-slate-400 leading-relaxed">${m.bio}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              ${m.expertise.map((t) => `<span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">${t}</span>`).join("")}
            </div>
            ${m.github ? `<a href="${m.github}" class="mt-3 inline-block text-sm text-emerald-400 underline hover:text-emerald-300" target="_blank" rel="noopener">GitHub Profile →</a>` : ""}
          </div>`).join("")}
      </div>`,
  ))}

    ${registry ? raw(section(
    "Capabilities",
    `<div class="grid gap-3 sm:grid-cols-2">
        ${registry.capabilities
      .filter((cap) => cap.status === "VERIFIED" || cap.status === "DECLARED")
      .map((cap) => `<div class="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-white">${cap.name}</span>
              <span class="text-xs rounded-full px-2 py-0.5 ${cap.status === "VERIFIED" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}">${cap.status}</span>
            </div>
            ${cap.description ? `<p class="mt-1 text-xs text-slate-400">${cap.description}</p>` : ""}
            ${cap.evidence.length > 0 ? `<div class="mt-2 flex flex-wrap gap-1">${cap.evidence.map((e) => `<span class="text-xs rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">${e.name}</span>`).join("")}</div>` : ""}
          </div>`).join("")}
      </div>
      <p class="mt-4 text-sm text-slate-400">
        <a href="/services" class="text-emerald-400 underline hover:text-emerald-300">See how these capabilities map to services →</a>
      </p>`,
  )) : ""}

    ${registry ? raw(section(
    "Availability",
    `<div class="space-y-2">
        ${registry.people
      .map((p) => `<div class="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3">
            <span class="text-sm text-slate-300">${p.name}</span>
            <span class="text-xs ${p.availability === "available" ? "text-emerald-400" : "text-amber-400"}">${p.availability}</span>
          </div>`).join("")}
      </div>`,
  )) : ""}

    ${registry ? raw(section(
    "Contact",
    `<div class="flex flex-wrap gap-2">
        ${(registry.people[0]?.contact.channels ?? ["telegram", "email"])
      .map((ch) => `<span class="text-xs rounded-full bg-slate-700 px-3 py-1 text-slate-300 capitalize">${ch}</span>`).join("")}
      </div>
      <p class="mt-4 text-sm text-slate-400">
        <a href="/work-with-us" class="text-emerald-400 underline hover:text-emerald-300">See engagement options →</a>
      </p>`,
  )) : ""}

    <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
      <p class="text-slate-300">Ready to become agent-ready?</p>
      <p class="mt-2 text-sm text-slate-400">
        <a href="/services/scanner" class="text-emerald-400 underline hover:text-emerald-300">Scan your API</a>,
        get an <a href="/services/passports" class="text-emerald-400 underline hover:text-emerald-300">agent passport</a>,
        or browse the <a href="/services/marketplace" class="text-emerald-400 underline hover:text-emerald-300">marketplace</a>.
      </p>
    </section>
  `;

  return Layout(content.toString(), PageMeta["/about"].title, PageMeta["/about"], jsonLd);
}
