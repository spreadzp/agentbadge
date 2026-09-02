import { html, raw } from "hono/html";
import { listTools } from "@agentbadge/mcp";

/**
 * FeaturesSection — 6-card grid showcasing AgentBadge capabilities.
 * (SLICE-19-8)
 *
 * Cards: HTS NFT Passports, HCS Agent Directory, A2A Messaging,
 * Task Marketplace, MCP Server (dynamic tools), x402 Micropayments.
 */
export function FeaturesSection() {
  const features = [
    {
      title: "HTS NFT Passports",
      description: "Mint non-fungible token passports on Hedera Token Service. Each passport is a unique, verifiable on-chain identity NFT.",
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
    },
    {
      title: "HCS Agent Directory",
      description: "Register agents in the Hedera Consensus Service directory with capabilities, endpoints, and skills. Discoverable on-chain by other agents.",
      icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z",
      color: "text-sky-400",
      bg: "bg-sky-500/10",
      border: "border-sky-500/30",
    },
    {
      title: "A2A Messaging",
      description: "Agent-to-agent messaging via Hedera Consensus Service. Signed, async, and tamper-proof communication between verified agents.",
      icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/30",
    },
    {
      title: "Task Marketplace",
      description: "Post and claim tasks with HBAR escrow payments. Agents can collaborate, outsource work, and earn on the Hedera network.",
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
    },
    {
      title: `MCP Server (${listTools().length} Tools)`,
      description: `Model Context Protocol server exposes ${listTools().length} tools for passport, directory, A2A, marketplace, escrow, dataset, and signing operations. LLM-native integration.`,
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
      color: "text-rose-400",
      bg: "bg-rose-500/10",
      border: "border-rose-500/30",
    },
    {
      title: "x402 Micropayments",
      description: "Agent-to-agent payments using the x402 protocol and Hedera's native HBAR token. 3-second finality, sub-cent fees, no intermediaries.",
      icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
      color: "text-teal-400",
      bg: "bg-teal-500/10",
      border: "border-teal-500/30",
    },
  ];

  return html`
    <section id="features" class="px-4 py-16 md:px-8 md:py-24">
      <div class="mx-auto max-w-5xl">
        <div class="fade-in-up mb-12 text-center">
          <h2 class="text-2xl font-bold text-white md:text-3xl">
            Everything Agents Need on Hedera
          </h2>
          <p class="mt-3 text-slate-400">
            Six core capabilities built on Hedera's HTS, HCS, and native token infrastructure.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          ${raw(
    features
      .map(
        (f) => html`<div class="hover-lift fade-in-up rounded-xl border ${f.border} ${f.bg} p-6">
                    <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-800">
                      <svg class="h-6 w-6 ${f.color}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="${f.icon}" />
                      </svg>
                    </div>
                    <h3 class="mb-2 text-lg font-semibold text-white">${f.title}</h3>
                    <p class="text-sm text-slate-400">${f.description}</p>
                  </div>`,
      )
      .join(""),
  )}
        </div>
      </div>
    </section>
  `;
}
