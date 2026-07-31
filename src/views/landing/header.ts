import { html } from "hono/html";

/**
 * LandingHeader — marketing navigation for the landing page.
 * (SLICE-19-1)
 *
 * Differs from dashboard header: no sidebar toggle, has About/Pricing/Dashboard links + Get Started CTA.
 */
export function LandingHeader(): ReturnType<typeof html> {
  return html`<header class="border-b border-slate-800 bg-slate-900">
    <nav class="px-4 py-3">
      <div class="relative flex items-center justify-between">
        <a href="/" class="flex items-center gap-2 font-semibold text-white">
          <picture><img src="/icons/logo-32.webp" srcset="/icons/logo-64.webp 2x" alt="" fetchpriority="high" class="h-7 w-7 rounded" /></picture>
          AgentGate
        </a>

        <!-- Desktop nav links -->
        <div class="hidden items-center gap-6 md:flex">
          <a href="/about" class="text-sm text-slate-300 hover:text-emerald-400 transition-colors">About</a>
          <a href="/pricing" class="text-sm text-slate-300 hover:text-emerald-400 transition-colors">Pricing</a>
          <a href="/dashboard" class="text-sm text-slate-300 hover:text-emerald-400 transition-colors">Dashboard</a>
          <a href="/agent-guide" class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors">
            Get Started
          </a>
        </div>

        <!-- Hamburger toggle (mobile only) — pure CSS, no JS -->
        <input id="nav-toggle" type="checkbox" class="peer hidden" />
        <label for="nav-toggle" class="cursor-pointer text-slate-300 hover:text-white md:hidden" aria-label="Toggle menu">
          <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </label>

        <!-- Mobile dropdown -->
        <div class="absolute left-0 right-0 top-full z-50 flex flex-col gap-1 overflow-hidden border-b border-slate-800 bg-slate-900 px-4 py-0 text-sm transition-all duration-200 max-h-0 peer-checked:max-h-80 peer-checked:py-3 md:hidden">
          <a href="/about" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">About</a>
          <a href="/pricing" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">Pricing</a>
          <a href="/dashboard" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">Dashboard</a>
          <a href="/agent-guide" class="mt-2 rounded-lg bg-emerald-500 px-4 py-2 text-center font-medium text-white">
            Get Started
          </a>
        </div>
      </div>
    </nav>
  </header>`;
}
