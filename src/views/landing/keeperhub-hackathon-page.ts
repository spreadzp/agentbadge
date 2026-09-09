import { html, raw } from "hono/html";

/**
 * KeeperHubHackathonPage — placeholder landing page for the KeeperHub Agent Economy hackathon.
 *
 * Real content (hero, architecture diagram, demo form, audit trail) lands in SLICE-126-15.
 * This placeholder establishes the URL shell and SEO metadata for Phase B-E slices.
 */
export function KeeperHubHackathonPage() {
  const sections = [
    KeeperHubHero().toString(),
    KeeperHubComing().toString(),
  ];

  return html`<div>${raw(sections.join(""))}</div>`;
}

function KeeperHubHero() {
  return html`<section class="relative overflow-hidden border-b border-slate-700/50 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-indigo-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          KeeperHub <span class="text-indigo-400">×</span> AgentBadge
        </h1>
        <p class="mt-6 text-lg text-slate-300 sm:text-xl">
          Onchain trust layer for agent readiness — powered by KeeperHub deterministic execution.
        </p>
        <p class="mt-4 text-sm text-slate-400">
          Integration in progress — demo form, live audit trail and onchain trust badges land here during the KeeperHub Agent Economy hackathon (Sep 6–18, 2026).
        </p>
      </div>
    </div>
  </section>`;
}

function KeeperHubComing() {
  return html`<section class="mx-auto max-w-4xl px-6 py-16 sm:px-8 lg:px-12">
    <h2 class="text-2xl font-bold text-white">Coming in this integration</h2>
    <ul class="mt-6 space-y-3 text-slate-300">
      <li class="flex items-start gap-3">
        <svg class="mt-1 h-5 w-5 shrink-0 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>Scan → onchain record (TrustRegistry, Base Sepolia)</span>
      </li>
      <li class="flex items-start gap-3">
        <svg class="mt-1 h-5 w-5 shrink-0 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>Soulbound TrustBadge NFT per verified scan</span>
      </li>
      <li class="flex items-start gap-3">
        <svg class="mt-1 h-5 w-5 shrink-0 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>KeeperHub workflows with dry-run preview</span>
      </li>
      <li class="flex items-start gap-3">
        <svg class="mt-1 h-5 w-5 shrink-0 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>Live audit trail with Basescan tx links</span>
      </li>
    </ul>
  </section>`;
}
