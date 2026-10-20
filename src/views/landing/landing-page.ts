import { html, raw } from "hono/html";
import { HeroSection } from "./hero";
import { LiveStatsSection } from "./live-stats";
import { ProblemSolutionSection } from "./problem-solution";
import { FeaturesSection } from "./features";
import { HowItWorksSection } from "./how-it-works";
import { ForWhoSection } from "./for-who";
import { ArchitectureSection } from "./architecture";
import { PricingPreviewSection } from "./pricing-preview";
import { CtaFooterSection } from "./cta-footer";
import { EngineeringCtaSection } from "./engineering-cta";

/**
 * LandingPage — assembler that composes all 9 sections in order.
 * (SLICE-19-11)
 *
 * Section order:
 * 1. Hero
 * 2. Live Stats
 * 3. Problem→Solution
 * 4. Features
 * 5. How It Works
 * 6. For Who
 * 7. Architecture
 * 8. Pricing Preview
 * 9. CTA Footer
 *
 * Sections are rendered as plain HTML — no hx-boost wrapper so that
 * CTA links navigate to full pages with their own layout (sidebar, footer).
 */
export function LandingPage(props: {
  totalIssued: number;
  activeCount: number;
  totalUpgrades: number;
  tasksCount: number;
}) {
  const sections = [
    HeroSection().toString(),
    LiveStatsSection(props).toString(),
    ProblemSolutionSection().toString(),
    FeaturesSection().toString(),
    HowItWorksSection().toString(),
    ForWhoSection().toString(),
    ArchitectureSection().toString(),
    PricingPreviewSection().toString(),
    EngineeringCtaSection().toString(),
    CtaFooterSection().toString(),
  ];

  return html`<div class="relative">
    ${raw(sections.join(""))}
    <button
      type="button"
      onclick="window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'})"
      aria-label="Scroll to bottom"
      title="Scroll to bottom"
      class="absolute right-4 top-24 z-10 hidden h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80 text-slate-300 shadow-lg backdrop-blur transition hover:border-emerald-500 hover:text-emerald-400 md:flex"
    >
      <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
    </button>
    <button
      type="button"
      onclick="window.scrollTo({top:0,behavior:'smooth'})"
      aria-label="Scroll to top"
      title="Scroll to top"
      class="absolute bottom-24 right-4 z-10 hidden h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80 text-slate-300 shadow-lg backdrop-blur transition hover:border-emerald-500 hover:text-emerald-400 md:flex"
    >
      <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
    </button>
  </div>`;
}
