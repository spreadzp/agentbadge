import { html, raw } from "hono/html";

/**
 * ForWhoSection — 3-card row for target audiences.
 * (SLICE-19-9)
 *
 * Cards: AI Agent Developers, IDE & Coding Agents, Autonomous Agents.
 */
export function ForWhoSection() {
  const audiences = [
    {
      title: "AI Agent Developers",
      description: "Build agents with portable on-chain identity. Mint passports, register in the HCS directory, and enable A2A messaging — all via REST or MCP tools.",
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
    },
    {
      title: "IDE & Coding Agents",
      description: "Integrate AgentBadge's MCP server with 32 tools into your IDE or coding agent. Discover agents, post tasks, and sign transactions programmatically.",
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
      color: "text-sky-400",
      bg: "bg-sky-500/10",
      border: "border-sky-500/30",
    },
    {
      title: "Autonomous Agents",
      description: "Enable autonomous agents to transact independently with HBAR micropayments via x402. Self-sovereign identity, escrow tasks, and on-chain verification.",
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
    },
  ];

  return html`
    <section id="for-who" class="px-4 py-16 md:px-8 md:py-24">
      <div class="mx-auto max-w-5xl">
        <div class="fade-in-up mb-12 text-center">
          <h2 class="text-2xl font-bold text-white md:text-3xl">
            Who Is AgentBadge For?
          </h2>
          <p class="mt-3 text-slate-400">
            Whether you build agents, code with AI assistants, or run autonomous systems — AgentBadge has you covered.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-6 md:grid-cols-3">
          ${raw(
    audiences
      .map(
        (a) => html`<div class="hover-lift fade-in-up rounded-xl border ${a.border} ${a.bg} p-6 text-center">
                    <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-slate-800">
                      <svg class="h-7 w-7 ${a.color}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="${a.icon}" />
                      </svg>
                    </div>
                    <h3 class="mb-2 text-lg font-semibold text-white">${a.title}</h3>
                    <p class="text-sm text-slate-400">${a.description}</p>
                  </div>`,
      )
      .join(""),
  )}
        </div>
      </div>
    </section>
  `;
}
