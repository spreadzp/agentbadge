import { html, raw } from "hono/html";

/**
 * HeroSection — landing page hero with animated gradient background.
 * (SLICE-19-4)
 *
 * Content:
 * - H1: "On-Chain Identity for AI Agents"
 * - UVP subheading mentioning Hedera HTS/HCS
 * - 2 CTAs: Get Started → /agent-guide, Explore Marketplace → /ui/market/tasks
 * - Trust badges: HTS, HCS, DID, x402
 * - CSS animations: gradient-animated, fade-in-up, pulse-glow
 */
export function HeroSection() {
  return html`
    <section id="hero" class="relative overflow-hidden">
      <!-- Animated gradient background -->
      <div class="gradient-animated absolute inset-0 opacity-20"></div>

      <!-- Content -->
      <div class="relative z-10 px-4 py-20 md:px-8 md:py-32">
        <div class="mx-auto max-w-4xl text-center">
          <!-- Trust badges -->
          <div class="fade-in-up mb-6 flex flex-wrap justify-center gap-2">
            <span class="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">HTS NFT Passports</span>
            <span class="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">HCS Directory</span>
            <span class="rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-300">DID Identity</span>
            <span class="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">x402 Payments</span>
          </div>

          <!-- H1 -->
          <h1 class="fade-in-up text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            On-Chain Identity for AI Agents
          </h1>

          <!-- UVP subheading -->
          <p class="fade-in-up mt-6 text-lg text-slate-300 md:text-xl">
            Mint NFT passports on Hedera, register in the HCS directory, and enable
            trustless agent-to-agent interactions with verifiable on-chain identity.
          </p>

          <!-- CTAs -->
          <div class="fade-in-up mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <a
              href="/agent-guide"
              class="pulse-glow inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              Get Started
              <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="/ui/market/tasks"
              class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
            >
              Explore Marketplace
            </a>
          </div>

          <!-- Stats row -->
          <div class="fade-in-up mt-16 grid grid-cols-3 gap-4 sm:gap-8">
            <div class="text-center">
              <div class="text-2xl font-bold text-emerald-400 sm:text-3xl">20+</div>
              <div class="mt-1 text-xs text-slate-400 sm:text-sm">Passports Minted</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-sky-400 sm:text-3xl">32</div>
              <div class="mt-1 text-xs text-slate-400 sm:text-sm">MCP Tools</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-purple-400 sm:text-3xl">4</div>
              <div class="mt-1 text-xs text-slate-400 sm:text-sm">Tiers Available</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
