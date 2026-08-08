import { html, raw } from "hono/html";
import { ReadinessHeroSection } from "./sections/readiness-hero";
import { ReadinessHowSection } from "./sections/readiness-how";
import { ReadinessEvidenceSection } from "./sections/readiness-evidence";
import { ReadinessFixSection } from "./sections/readiness-fix";
import { ReadinessWorkflowSection } from "./sections/readiness-workflow";
import { ReadinessKnowledgeSection } from "./sections/readiness-knowledge";
import { ReadinessPricingSection } from "./sections/readiness-pricing";
import { ReadinessAudienceSection } from "./sections/readiness-audience";
import { ReadinessThesisSection } from "./sections/readiness-thesis";
import { EngineeringCtaSection } from "./engineering-cta";

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
 * 7. Pricing (SLICE-43-6) ✅
 * 8. Audience (SLICE-43-6) ✅
 * 9. Thesis / CTA (SLICE-43-6) ✅
 */
export function ReadinessLandingPage() {
  const sections = [
    ReadinessHeroSection().toString(),
    ReadinessHowSection().toString(),
    ReadinessEvidenceSection().toString(),
    ReadinessFixSection().toString(),
    ReadinessWorkflowSection().toString(),
    ReadinessKnowledgeSection().toString(),
    ReadinessPricingSection().toString(),
    ReadinessAudienceSection().toString(),
    EngineeringCtaSection().toString(),
    ReadinessThesisSection().toString(),
  ];

  const webmcpScript = `<script>
if ('modelContext' in navigator) {
  navigator.modelContext.provideContext([
    {
      name: 'agent-readiness-scan',
      description: 'Scan any URL for agent readiness compliance',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to scan' }
        },
        required: ['url']
      },
      execute: async (input) => {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        });
        return res.json();
      }
    },
    {
      name: 'badge-generate',
      description: 'Generate an agent readiness badge SVG',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to generate badge for' },
          format: { type: 'string', description: 'Badge format: svg or json' }
        },
        required: ['url']
      },
      execute: async (input) => {
        const res = await fetch('/api/badge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        });
        return res.text();
      }
    },
    {
      name: 'passport-issue',
      description: 'Issue an agent passport NFT on Hedera',
      inputSchema: {
        type: 'object',
        properties: {
          tier: { type: 'string', description: 'Passport tier: bronze, silver, gold, platinum' }
        },
        required: ['tier']
      },
      execute: async (input) => {
        const res = await fetch('/passport/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        });
        return res.json();
      }
    }
  ]);
}
</script>`;

  return html`<div id="agent-readiness-landing">${raw(sections.join(""))}${raw(webmcpScript)}</div>`;
}
