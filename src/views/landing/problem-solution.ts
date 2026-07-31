import { html, raw } from "hono/html";

/**
 * ProblemSolutionSection — 4-card grid showing problem→solution pairs.
 * (SLICE-19-6)
 *
 * Cards:
 * 1. No portable identity → NFT passports (HTS)
 * 2. No discovery → HCS directory
 * 3. No payments → HBAR x402
 * 4. No standard → MCP 32 tools
 */
export function ProblemSolutionSection() {
  const cards = [
    {
      problem: "No portable identity",
      solution: "NFT Passports on Hedera HTS",
      description: "Mint non-fungible token passports as on-chain identity. Verifiable on HashScan, portable across platforms.",
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
    },
    {
      problem: "No agent discovery",
      solution: "HCS Directory Registration",
      description: "Register agents in the Hedera Consensus Service directory with capabilities, endpoints, and skills. Discoverable on-chain.",
      icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
      color: "text-sky-400",
      bg: "bg-sky-500/10",
      border: "border-sky-500/30",
    },
    {
      problem: "No built-in payments",
      solution: "HBAR Payments via x402",
      description: "Agent-to-agent payments using Hedera's native token and the x402 payment protocol. No intermediaries, 3-second finality.",
      icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
    },
    {
      problem: "No interaction standard",
      solution: "MCP Server with 32 Tools",
      description: "Model Context Protocol server exposes 32 tools for passport, directory, A2A, marketplace, and signing operations.",
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/30",
    },
  ];

  return html`
    <section id="problem-solution" class="px-4 py-16 md:px-8 md:py-24">
      <div class="mx-auto max-w-5xl">
        <div class="fade-in-up mb-12 text-center">
          <h2 class="text-2xl font-bold text-white md:text-3xl">
            The Problem with AI Agent Identity
          </h2>
          <p class="mt-3 text-slate-400">
            AI agents lack portable identity, discovery, payments, and interaction standards.
            AgentGate solves all four on Hedera's on-chain network.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
          ${raw(
    cards
      .map(
        (card) => html`<div class="hover-lift fade-in-up rounded-xl border ${card.border} ${card.bg} p-6">
                    <div class="mb-4 flex items-center gap-3">
                      <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800">
                        <svg class="h-5 w-5 ${card.color}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" d="${card.icon}" />
                        </svg>
                      </div>
                      <div>
                        <div class="text-xs uppercase tracking-wide text-slate-400">Without AgentGate</div>
                        <div class="text-sm font-medium text-slate-400 line-through">${card.problem}</div>
                      </div>
                    </div>
                    <div class="mb-2 text-lg font-bold ${card.color}">${card.solution}</div>
                    <p class="text-sm text-slate-400">${card.description}</p>
                  </div>`,
      )
      .join(""),
  )}
        </div>
      </div>
    </section>
  `;
}
