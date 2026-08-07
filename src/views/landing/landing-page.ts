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

  return html`<div>${raw(sections.join(""))}</div>`;
}
