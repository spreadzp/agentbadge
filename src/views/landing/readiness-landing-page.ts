import { html, raw } from "hono/html";
import { ReadinessHeroSection } from "./sections/readiness-hero";
import { ReadinessHowSection } from "./sections/readiness-how";
import { ReadinessEvidenceSection } from "./sections/readiness-evidence";
import { ReadinessFixSection } from "./sections/readiness-fix";
import { ReadinessWorkflowSection } from "./sections/readiness-workflow";
import { ReadinessKnowledgeSection } from "./sections/readiness-knowledge";

/**
 * ReadinessLandingPage — assembler for the Agent Readiness landing page.
 * SLICE-43-2
 *
 * Section order (planned across SLICE-43-2 through 43-6):
 * 1. Hero (SLICE-43-2) ✅
 * 2. Problem + 4 categories + pipeline (SLICE-43-3) ✅
 * 3. Evidence-first (SLICE-43-4) ✅
 * 4. Fix types (SLICE-43-4) ✅
 * 5. Developer workflow (SLICE-43-5) ✅
 * 6. Agent Knowledge Layer (SLICE-43-5) ✅
 * 7. Pricing (SLICE-43-6)
 * 8. Audience (SLICE-43-6)
 * 9. Thesis / CTA (SLICE-43-6)
 */
export function ReadinessLandingPage() {
  const sections = [
    ReadinessHeroSection().toString(),
    ReadinessHowSection().toString(),
    ReadinessEvidenceSection().toString(),
    ReadinessFixSection().toString(),
    ReadinessWorkflowSection().toString(),
    ReadinessKnowledgeSection().toString(),
  ];

  return html`<div id="agent-readiness-landing">${raw(sections.join(""))}</div>`;
}
