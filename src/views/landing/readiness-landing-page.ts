import { html, raw } from "hono/html";
import { ReadinessHeroSection } from "./sections/readiness-hero";
import { ReadinessImmediateProofSection } from "./sections/readiness-immediate-proof";
import { ReadinessConceptualFlowSection } from "./sections/readiness-conceptual-flow";
import { ReadinessAgentReadyProofSection } from "./sections/readiness-agent-ready-proof";
import { ReadinessPassportSecondarySection } from "./sections/readiness-passport-secondary";
import { ReadinessHowSection } from "./sections/readiness-how";
import { ReadinessEvidenceSection } from "./sections/readiness-evidence";
import { ReadinessFixSection } from "./sections/readiness-fix";
import { ReadinessWorkflowSection } from "./sections/readiness-workflow";
import { ReadinessKnowledgeSection } from "./sections/readiness-knowledge";
import { ReadinessPricingSection } from "./sections/readiness-pricing";
import { ReadinessThesisSection } from "./sections/readiness-thesis";
import { EngineeringCtaSection } from "./engineering-cta";
import { RelatedLinks } from "../related-links";
import { HOMEPAGE_FAQ } from "../faq-page";
import { faqPageLd } from "../../server/lib/json-ld";
import { applyChainTemplates } from "../../server/lib/chain-templates.js";

const homepageCrossLinks = [
  { label: "Blog", href: "/blog", description: "Deep dives into agent readiness, MCP, and the agentic web" },
  { label: "FAQ", href: "/faq", description: "Common questions about AgentBadge and agent readiness" },
  { label: "Use Cases", href: "/use-cases", description: "Real-world scenarios for agent-ready APIs" },
  { label: "What Is Agent Readiness?", href: "/what-is-agent-readiness", description: "The canonical guide to agent readiness" },
];

/**
 * ReadinessLandingPage — assembler for the Agent Readiness landing page.
 * SLICE-43-2 + SLICE-110-6 repositioning
 *
 * Section order (SLICE-110-6):
 * 1. Hero (SLICE-110-2)
 * 2. Immediate proof (SLICE-110-3)
 * 3. Conceptual flow (SLICE-110-4)
 * 4. How it works (SLICE-43-3, repositioned)
 * 5. Agent-Ready proof (SLICE-110-5)
 * 6. Evidence & Fix (SLICE-43-4, condensed)
 * 7. Workflow (SLICE-43-5)
 * 8. Knowledge (SLICE-43-5)
 * 9. Pricing (SLICE-43-6)
 * 10. CTA / Thesis (SLICE-43-6)
 */
export function getHomepageFaqJsonLd(): object {
  return faqPageLd(
    HOMEPAGE_FAQ.map((item) => ({
      question: item.question,
      answer: applyChainTemplates(item.shortAnswer),
    })),
  );
}

function FaqSection() {
  return html`
    <section class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-3xl">
        <h2 class="text-2xl font-bold text-white text-center">Frequently Asked Questions</h2>
        <p class="mt-3 text-slate-400 text-center max-w-2xl mx-auto">
          Quick answers about AgentBadge, agent readiness, and on-chain identity.
        </p>
        <div class="mt-8 space-y-4">
          ${raw(HOMEPAGE_FAQ.map((item) => html`
            <details class="group rounded-lg border border-slate-800 bg-slate-900/50 p-5">
              <summary class="flex cursor-pointer items-center justify-between text-white font-medium">
                ${item.question}
                <svg class="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </summary>
              <p class="mt-3 text-sm text-slate-400">${raw(applyChainTemplates(item.shortAnswer))}</p>
              <a href="/faq#${item.faqAnchor}" class="mt-2 inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300">
                Read more
                <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
              </a>
            </details>
          `).join(""))}
        </div>
        <div class="mt-6 text-center">
          <a href="/faq" class="inline-flex items-center gap-2 text-sm font-medium text-emerald-400 hover:text-emerald-300">
            See all FAQs
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          </a>
        </div>
      </div>
    </section>
  `;
}

export function ReadinessLandingPage() {
  const sections = [
    ReadinessHeroSection().toString(),
    ReadinessImmediateProofSection().toString(),
    ReadinessConceptualFlowSection().toString(),
    ReadinessHowSection().toString(),
    ReadinessAgentReadyProofSection().toString(),
    ReadinessPassportSecondarySection().toString(),
    ReadinessEvidenceSection().toString(),
    ReadinessFixSection().toString(),
    ReadinessWorkflowSection().toString(),
    ReadinessKnowledgeSection().toString(),
    ReadinessPricingSection().toString(),
    EngineeringCtaSection().toString(),
    FaqSection().toString(),
    RelatedLinks("Explore More", homepageCrossLinks),
    ReadinessThesisSection().toString(),
  ];

  return html`<div id="agent-readiness-landing">${raw(sections.join(""))}</div>`;
}
