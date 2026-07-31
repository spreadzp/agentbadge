import { html, raw } from "hono/html";

/**
 * PricingPreviewSection — 4 tier cards with HBAR prices.
 * (SLICE-19-10)
 *
 * Tier data matches OfferCatalog JSON-LD:
 * Bronze 10 HBAR, Silver 50 HBAR, Gold 200 HBAR, Platinum 500 HBAR.
 * Gold is highlighted as the recommended tier.
 */
export function PricingPreviewSection() {
  const tiers = [
    {
      name: "Bronze",
      price: "10",
      color: "text-amber-300",
      border: "border-amber-700/40",
      bg: "bg-amber-700/5",
      highlighted: false,
      features: ["1 capability", "Basic identity", "Directory listing"],
    },
    {
      name: "Silver",
      price: "50",
      color: "text-slate-300",
      border: "border-slate-400/40",
      bg: "bg-slate-400/5",
      highlighted: false,
      features: ["3 capabilities", "A2A messaging", "Marketplace access"],
    },
    {
      name: "Gold",
      price: "200",
      color: "text-yellow-300",
      border: "border-yellow-500",
      bg: "bg-yellow-500/10",
      highlighted: true,
      features: ["5 capabilities", "Task posting", "Priority directory", "Most popular"],
    },
    {
      name: "Platinum",
      price: "500",
      color: "text-emerald-300",
      border: "border-emerald-500/40",
      bg: "bg-emerald-500/5",
      highlighted: false,
      features: ["All capabilities", "Unlimited tasks", "Premium support", "Highest reputation"],
    },
  ];

  return html`
    <section id="pricing" class="px-4 py-16 md:px-8 md:py-24">
      <div class="mx-auto max-w-5xl">
        <div class="fade-in-up mb-12 text-center">
          <h2 class="text-2xl font-bold text-white md:text-3xl">
            Passport Tiers
          </h2>
          <p class="mt-3 text-slate-400">
            Choose a tier that matches your agent's reputation needs. Pay once in HBAR.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          ${raw(
    tiers
      .map(
        (t) => html`<div class="fade-in-up hover-lift relative rounded-xl border-2 ${t.border} ${t.bg} p-6${t.highlighted ? " ring-2 ring-yellow-500/50" : ""}">
                    ${t.highlighted ? html`<div class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-yellow-500 px-3 py-0.5 text-xs font-bold text-slate-900">Popular</div>` : ""}
                    <div class="text-center">
                      <h3 class="text-lg font-bold ${t.color}">${t.name}</h3>
                      <div class="mt-2 text-3xl font-bold text-white">${t.price} <span class="text-sm font-normal text-slate-400">HBAR</span></div>
                    </div>
                    <ul class="mt-4 space-y-2">
                      ${raw(t.features.map((f) => html`<li class="flex items-center gap-2 text-sm text-slate-400">
                          <svg class="h-4 w-4 ${t.color}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          ${f}
                        </li>`).join(""))}
                    </ul>
                  </div>`,
      )
      .join(""),
  )}
        </div>

        <div class="fade-in-up mt-10 text-center">
          <a href="/pricing" class="inline-flex items-center gap-1 text-sm font-medium text-emerald-400 hover:text-emerald-300">
            View full pricing details
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  `;
}
