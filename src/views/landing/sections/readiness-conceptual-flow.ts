import { html, raw } from "hono/html";

/**
 * ReadinessConceptualFlowSection — "Discover → Understand → Access → Act"
 * conceptual model showing the 4-step agent interaction pipeline.
 * SLICE-110-4
 */
export function ReadinessConceptualFlowSection() {
  const steps = [
    {
      num: "01",
      icon: "🔍",
      title: "Discover",
      question: "Can agents find your API?",
      desc: "llms.txt, robots.txt, WebMCP manifest, well-known URIs",
    },
    {
      num: "02",
      icon: "📖",
      title: "Understand",
      question: "Can agents read your docs?",
      desc: "OpenAPI spec, agent-guide, structured schemas, capability descriptions",
    },
    {
      num: "03",
      icon: "🔑",
      title: "Access",
      question: "Can agents authenticate?",
      desc: "API keys, OAuth flows, x402 payments, auth documentation",
    },
    {
      num: "04",
      icon: "⚡",
      title: "Act",
      question: "Can agents execute successfully?",
      desc: "Error schemas, rate limits, idempotency, structured responses",
    },
  ];

  return html`
    <section class="px-4 py-16 md:px-8 md:py-20 border-t border-slate-800/50">
      <div class="mx-auto max-w-6xl">
        <div class="text-center mb-12">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            Conceptual Model
          </div>
          <h2 class="mt-3 text-3xl md:text-4xl font-bold text-white">
            The Agent Interaction Pipeline
          </h2>
          <p class="mt-4 text-slate-400 max-w-2xl mx-auto">
            AgentBadge scores your API across four sequential stages —
            from discovery to execution. Each stage is independently measurable.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-0">
          ${raw(
            steps
              .map(
                (s, i) => `
          <div class="relative ${i < steps.length - 1 ? "md:border-r md:border-slate-700/50" : ""} md:pr-4">
            <div class="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6 ${i > 0 ? "md:ml-4" : ""}">
              <div class="flex items-center gap-3">
                <span class="text-3xl">${s.icon}</span>
                <span class="text-xs font-mono text-slate-600">${s.num}</span>
              </div>
              <h3 class="mt-4 text-xl font-bold text-white">${s.title}</h3>
              <p class="mt-1 text-sm text-emerald-400 font-medium">${s.question}</p>
              <p class="mt-2 text-xs text-slate-400">${s.desc}</p>
            </div>
            ${i < steps.length - 1 ? '<div class="hidden md:block absolute top-1/2 -right-3 text-slate-600 text-xl">→</div>' : ""}
          </div>`,
              )
              .join(""),
          )}
        </div>
      </div>
    </section>
  `;
}
