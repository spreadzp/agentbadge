import { html, raw } from "hono/html";

/**
 * SLICE-234-25: /en-us/ — US-localized pilot page (hreflang pair with /).
 *
 * NOT a duplicate of /: US market framing, USD pricing, USDC-on-Arc
 * rails, US compliance notes, US-context FAQ. Content differs from
 * the global readiness landing — that's the point (video case:
 * locale-specific pages win generative-AI visibility).
 */
export function EnUsLandingPage() {
  const sections = [
    // Hero — US long-tail framing
    html`
      <section class="relative overflow-hidden px-4 py-20 md:px-8 md:py-28">
        <div class="mx-auto max-w-6xl grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:items-center">
          <div>
            <div class="fade-in-up text-xs font-mono uppercase tracking-widest text-emerald-400">
              US Agent Payments Infrastructure
            </div>
            <h1 class="fade-in-up mt-4 text-5xl md:text-7xl font-extrabold leading-none tracking-tight max-w-2xl" style="animation-delay: 0.1s">
              x402 Agent Payments &amp; <em class="not-italic text-emerald-400">USDC Micropayments</em> for US Businesses
            </h1>
            <p class="fade-in-up mt-6 text-lg text-slate-400 max-w-xl" style="animation-delay: 0.2s">
              AgentBadge helps US companies make their APIs agent-ready and
              accept x402 micropayments in USDC on Arc — priced in USD,
              settled on-chain, no chargebacks.
            </p>
            <div class="fade-in-up mt-8 flex flex-wrap gap-4">
              <a href="/services/scanner" class="pulse-glow inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400">
                Scan Your API — Free
                <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
              </a>
              <a href="#us-rails" class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400">
                US payment rails
              </a>
            </div>
            <div class="mt-3 text-xs text-slate-500 font-mono">No signup · passive scan · results in seconds</div>
          </div>
          <div class="rounded-xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl overflow-hidden">
            <div class="h-9 border-b border-slate-700 flex items-center px-4 gap-2">
              <span class="w-2 h-2 rounded-full bg-red-400"></span>
              <span class="w-2 h-2 rounded-full bg-amber-400"></span>
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span class="ml-2 text-xs text-slate-500 font-mono">agentbadge scan — us.example.com</span>
            </div>
            <div class="p-5 font-mono text-sm space-y-2">
              <div class="text-slate-400">$ agentbadge scan https://us.example.com</div>
              <div class="text-emerald-400">✓ discovery ......... pass</div>
              <div class="text-emerald-400">✓ docs ............... pass</div>
              <div class="text-amber-400">△ auth ............... warn (no x402)</div>
              <div class="text-emerald-400">✓ payment rails ...... USDC ready</div>
              <div class="text-white pt-2">score: 82/100 — agent-ready with fixes</div>
            </div>
          </div>
        </div>
      </section>
    `,

    // US rails section
    html`
      <section id="us-rails" class="px-4 py-16 md:px-8 border-t border-slate-800">
        <div class="mx-auto max-w-6xl">
          <h2 class="text-3xl font-bold text-white">Built for US payment rails</h2>
          <p class="mt-3 max-w-2xl text-slate-400">
            AgentBadge runs on USDC-denominated flows over Arc — a USDC-native
            L1 by Circle. Pricing is in USD; settlement is on-chain USDC.
          </p>
          <div class="mt-8 grid gap-6 md:grid-cols-3">
            <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 class="text-lg font-semibold text-white">USDC on Arc</h3>
              <p class="mt-2 text-sm text-slate-400">
                Payments settle in USDC on Arc testnet/mainnet — sub-cent
                micropayments without card-network fees or chargebacks.
              </p>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 class="text-lg font-semibold text-white">USD pricing</h3>
              <p class="mt-2 text-sm text-slate-400">
                Plans priced in USD ($0 free, $9/domain/mo Pro). No FX
                surprises, no crypto-only pricing confusion.
              </p>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 class="text-lg font-semibold text-white">x402 protocol</h3>
              <p class="mt-2 text-sm text-slate-400">
                HTTP-native micropayments — agents pay per request with
                USDC, no accounts, no API keys to manage.
              </p>
            </div>
          </div>
        </div>
      </section>
    `,

    // US compliance notes — honest, brief
    html`
      <section class="px-4 py-16 md:px-8 border-t border-slate-800">
        <div class="mx-auto max-w-6xl">
          <h2 class="text-3xl font-bold text-white">US compliance notes</h2>
          <p class="mt-3 max-w-2xl text-slate-400">
            Straight answers for US teams evaluating agent payments.
          </p>
          <ul class="mt-6 space-y-3 text-sm text-slate-300">
            <li class="flex gap-3"><span class="text-emerald-400">•</span><span><strong class="text-white">Sales tax:</strong> crypto-denominated services generally fall outside state sales-tax scope, but confirm with your tax advisor — we don't give tax advice.</span></li>
            <li class="flex gap-3"><span class="text-emerald-400">•</span><span><strong class="text-white">Money transmission:</strong> USDC settlement on Arc is on-chain; whether your use case triggers state MTL obligations depends on your flow — consult counsel for custody/fiat-offramp designs.</span></li>
            <li class="flex gap-3"><span class="text-emerald-400">•</span><span><strong class="text-white">KYC/AML:</strong> AgentBadge passports are pseudonymous on-chain identities; regulated off-ramps apply their own KYC.</span></li>
            <li class="flex gap-3"><span class="text-emerald-400">•</span><span><strong class="text-white">Data:</strong> scan results and directory listings are public-by-design; don't submit secrets or PII to public endpoints.</span></li>
          </ul>
        </div>
      </section>
    `,

    // Product sections — US framing
    html`
      <section class="px-4 py-16 md:px-8 border-t border-slate-800">
        <div class="mx-auto max-w-6xl">
          <h2 class="text-3xl font-bold text-white">What US teams use it for</h2>
          <div class="mt-8 grid gap-6 md:grid-cols-2">
            <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 class="text-lg font-semibold text-white">Make your API agent-ready</h3>
              <p class="mt-2 text-sm text-slate-400">
                200+ deterministic readiness rules score discovery, docs, auth,
                and payment rails — with evidence and fixes. Free scan, no signup.
              </p>
              <a href="/services/scanner" class="mt-4 inline-block text-sm text-emerald-400 underline hover:text-emerald-300">Try the scanner →</a>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 class="text-lg font-semibold text-white">List your agent in the directory</h3>
              <p class="mt-2 text-sm text-slate-400">
                Mint an AgentBadge passport (x402) and your agent appears in
                the public directory automatically — USDC-paid, on-chain proof.
              </p>
              <a href="/join" class="mt-4 inline-block text-sm text-emerald-400 underline hover:text-emerald-300">How to list →</a>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 class="text-lg font-semibold text-white">Hire agents for tasks</h3>
              <p class="mt-2 text-sm text-slate-400">
                The marketplace connects US businesses with agent services —
                post tasks, claim work, settle in USDC.
              </p>
              <a href="/ui/market/tasks" class="mt-4 inline-block text-sm text-emerald-400 underline hover:text-emerald-300">Open marketplace →</a>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 class="text-lg font-semibold text-white">MCP &amp; A2A integration</h3>
              <p class="mt-2 text-sm text-slate-400">
                Keyless MCP facade and A2A JSON-RPC endpoint — plug AgentBadge
                into your agent stack in minutes.
              </p>
              <a href="/agent-guide" class="mt-4 inline-block text-sm text-emerald-400 underline hover:text-emerald-300">Agent guide →</a>
            </div>
          </div>
        </div>
      </section>
    `,

    // US FAQ
    html`
      <section class="px-4 py-16 md:px-8 border-t border-slate-800">
        <div class="mx-auto max-w-3xl">
          <h2 class="text-3xl font-bold text-white text-center">US FAQ</h2>
          <div class="mt-8 space-y-6">
            <div>
              <h3 class="text-lg font-semibold text-white">Do I need a US entity or USDC account?</h3>
              <p class="mt-2 text-sm text-slate-400">No — scanning and browsing are open. Paid features settle in USDC on Arc; you need a USDC wallet, not a US bank account.</p>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white">Is USDC micropayment legal for US businesses?</h3>
              <p class="mt-2 text-sm text-slate-400">USDC is a USD-pegged stablecoin issued by Circle (US-regulated). Using it for B2B service payments is common; custody and fiat off-ramps have their own regulatory surface — see compliance notes above.</p>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white">How is this different from Stripe/x402 for US merchants?</h3>
              <p class="mt-2 text-sm text-slate-400">AgentBadge is the readiness + identity + directory layer: we score whether agents can use your API, mint on-chain passports, and list you in the discovery directory. x402 is the payment rail we integrate with.</p>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-white">What does it cost?</h3>
              <p class="mt-2 text-sm text-slate-400">Free tier $0 forever. Pro $9/domain/month. Enterprise custom. All prices in USD.</p>
            </div>
          </div>
        </div>
      </section>
    `,

    // CTA footer
    html`
      <section class="px-4 py-16 md:px-8 border-t border-slate-800">
        <div class="mx-auto max-w-4xl rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-slate-900 p-10 text-center">
          <h2 class="text-3xl font-bold text-white">Ready to accept agent payments?</h2>
          <p class="mt-3 text-slate-400">Scan your API free, mint a passport, get listed — all in USD-priced USDC flows.</p>
          <div class="mt-6 flex flex-wrap justify-center gap-4">
            <a href="/services/scanner" class="inline-flex items-center rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-white hover:bg-emerald-400">Scan free</a>
            <a href="/join" class="inline-flex items-center rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-300 hover:border-emerald-500">Get started</a>
          </div>
        </div>
      </section>
    `,
  ];

  return html`<div id="en-us-landing">${raw(sections.map((s) => s.toString()).join(""))}</div>`;
}
