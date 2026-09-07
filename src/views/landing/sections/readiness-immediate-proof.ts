import { html, raw } from "hono/html";
import { RULE_DESCRIPTIONS } from "../../../agent-readiness/rule-descriptions";

/**
 * ReadinessImmediateProofSection — static proof that AgentBadge реально
 * проверяет API. Pulls rule count dynamically from RULE_DESCRIPTIONS.
 * SLICE-110-3
 */
export function ReadinessImmediateProofSection() {
  const ruleCount = RULE_DESCRIPTIONS.length;

  const stats = [
    { value: `${ruleCount}+`, label: "Automated checks", sub: "across 15 categories" },
    { value: "4", label: "Scoring pillars", sub: "Discovery · Understandability · Executability · Verifiability" },
    { value: "3", label: "Evidence levels", sub: "VERIFIED · CONFLICT · INFERRED" },
    { value: "100%", label: "Reproducible", sub: "deterministic, no LLM hallucination" },
  ];

  const features = [
    { icon: "📋", title: "OpenAPI Analysis", desc: "Schema parsing, auth detection, error handling checks" },
    { icon: "🔍", title: "AI-Agent Discovery", desc: "llms.txt, robots.txt, agent-guide, well-known URIs" },
    { icon: "🔌", title: "WebMCP Support", desc: "webmcp.json validation, MCP server descriptor checks" },
    { icon: "📊", title: "Evidence-Based Scoring", desc: "Every score backed by fetched proof, not guesswork" },
  ];

  return html`
    <section class="px-4 py-16 md:px-8 md:py-20 border-t border-slate-800/50">
      <div class="mx-auto max-w-6xl">
        <div class="text-center mb-12">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            Immediate Proof
          </div>
          <h2 class="mt-3 text-3xl md:text-4xl font-bold text-white">
            What AgentBadge Actually Checks
          </h2>
          <p class="mt-4 text-slate-400 max-w-2xl mx-auto">
            ${ruleCount}+ deterministic checks across 15 categories — evidence-based scoring,
            not LLM hallucination. Every result is backed by fetched proof.
          </p>
        </div>

        <!-- Stat cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          ${raw(
    stats
      .map(
        (s) => `
            <div class="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5 text-center">
              <div class="text-3xl md:text-4xl font-extrabold text-emerald-400">${s.value}</div>
              <div class="mt-2 text-sm font-semibold text-white">${s.label}</div>
              <div class="mt-1 text-xs text-slate-500">${s.sub}</div>
            </div>`,
      )
      .join(""),
  )}
        </div>

        <!-- Feature badges -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          ${raw(
    features
      .map(
        (f) => `
          <div class="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4">
            <div class="text-2xl">${f.icon}</div>
            <div class="mt-2 text-sm font-semibold text-white">${f.title}</div>
            <div class="mt-1 text-xs text-slate-400">${f.desc}</div>
          </div>`,
      )
      .join(""),
  )}
        </div>
      </div>
    </section>
  `;
}
