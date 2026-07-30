import { html, raw } from "hono/html";

/**
 * ArchitectureSection — 6 tech pills + link to /about.
 * (SLICE-19-10)
 */
export function ArchitectureSection() {
  const pills = [
    { name: "HTS", description: "Hedera Token Service for NFT passports" },
    { name: "HCS", description: "Hedera Consensus Service for directory & messaging" },
    { name: "Mirror Node", description: "Free REST API for on-chain reads" },
    { name: "x402", description: "HTTP 402 payment protocol for micropayments" },
    { name: "MCP", description: "Model Context Protocol server (32 tools)" },
    { name: "IPFS", description: "Decentralized metadata storage for NFTs" },
  ];

  return html`
    <section id="architecture" class="px-4 py-16 md:px-8 md:py-24">
      <div class="mx-auto max-w-4xl">
        <div class="fade-in-up mb-12 text-center">
          <h2 class="text-2xl font-bold text-white md:text-3xl">
            Built on Hedera's Native Infrastructure
          </h2>
          <p class="mt-3 text-slate-400">
            Six core technologies working together for on-chain agent identity.
          </p>
        </div>

        <div class="fade-in-up flex flex-wrap justify-center gap-3">
          ${raw(
            pills
              .map(
                (p) => html`<div class="rounded-full border border-slate-700 bg-slate-900 px-5 py-2.5 text-center">
                    <span class="font-semibold text-emerald-400">${p.name}</span>
                    <span class="ml-2 text-sm text-slate-400">${p.description}</span>
                  </div>`,
              )
              .join(""),
          )}
        </div>

        <div class="fade-in-up mt-10 text-center">
          <a href="/about" class="inline-flex items-center gap-1 text-sm font-medium text-emerald-400 hover:text-emerald-300">
            Learn more about the architecture
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  `;
}
