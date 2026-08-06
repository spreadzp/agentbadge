import { html } from "hono/html";

/**
 * ReadinessEvidenceSection — "Evidence-first" section with terminal findings
 * and the "Deterministic before intelligent" principle card.
 * SLICE-43-4
 *
 * Content:
 * - Eyebrow: "Evidence-first"
 * - H2: "Not 'AI thinks you're 76/100.'"
 * - Terminal with findings: VERIFIED, CONFLICT, INFERRED, MISSING pills
 * - Card: "Deterministic before intelligent" principle
 */
export function ReadinessEvidenceSection() {
  return html`
    <section id="evidence" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-6xl">
        <!-- Section head -->
        <div class="max-w-3xl mb-10">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            Evidence-first
          </div>
          <h2 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight leading-tight">
            Not "AI thinks you're 76/100."
          </h2>
          <p class="mt-4 text-slate-400 text-lg">
            Every important finding is tied to observable evidence. The ruleset is versioned and reproducible.
          </p>
        </div>

        <!-- Evidence grid: terminal + principle card -->
        <div class="grid gap-5 lg:grid-cols-2">
          <!-- Terminal with findings -->
          <div class="rounded-lg border border-slate-700 bg-slate-950 p-6 font-mono text-[13px] leading-relaxed text-slate-300">
            <div class="text-slate-500">$ report.json</div>
            <div class="flex justify-between border-b border-slate-800 py-2.5">
              <span>AB-001 OpenAPI</span>
              <span class="text-[10px] border border-slate-600 rounded px-1.5 py-0.5 text-emerald-400">VERIFIED</span>
            </div>
            <div class="flex justify-between border-b border-slate-800 py-2.5">
              <span>GET /openapi.json → 200</span>
              <span class="text-emerald-400">confidence 1.0</span>
            </div>
            <div class="flex justify-between border-b border-slate-800 py-2.5">
              <span>Authentication</span>
              <span class="text-[10px] border border-slate-600 rounded px-1.5 py-0.5 text-emerald-400">VERIFIED</span>
            </div>
            <div class="flex justify-between border-b border-slate-800 py-2.5">
              <span>POST /refund</span>
              <span class="text-[10px] border border-slate-600 rounded px-1.5 py-0.5 text-red-400">CONFLICT</span>
            </div>
            <div class="flex justify-between border-b border-slate-800 py-2.5">
              <span>Guide capability</span>
              <span class="text-[10px] border border-slate-600 rounded px-1.5 py-0.5 text-amber-400">INFERRED</span>
            </div>
            <div class="flex justify-between py-2.5">
              <span>Structured errors</span>
              <span class="text-[10px] border border-slate-600 rounded px-1.5 py-0.5 text-slate-500">MISSING</span>
            </div>
            <div class="mt-4 text-slate-600">ruleset: agent-readiness-v1.2</div>
            <div class="text-slate-600">report_hash: 9a31...f02d</div>
          </div>

          <!-- Principle card -->
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">DETERMINISTIC BEFORE INTELLIGENT</div>
            <h3 class="text-lg font-semibold mb-2">AI is a copilot, not the judge.</h3>
            <p class="text-slate-400 text-sm">
              Deterministic checks handle facts we can prove. AI can help interpret ambiguous documentation,
              propose fixes and explain findings — but inferred capabilities require human confirmation.
            </p>
            <p class="mt-4 font-bold text-slate-200">Don't certify. Measure.</p>
          </div>
        </div>
      </div>
    </section>
  `;
}
