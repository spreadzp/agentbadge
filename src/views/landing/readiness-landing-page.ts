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
    ReadinessThesisSection().toString(),
  ];

  return html`<div id="agent-readiness-landing">${raw(sections.join(""))}</div>`;
}
