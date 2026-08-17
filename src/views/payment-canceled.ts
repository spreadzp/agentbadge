/**
 * Payment canceled page view.
 *
 * SLICE-67-5: Cancel page shown when user aborts Stripe checkout.
 */

import { Layout } from "./layout";

export function renderPaymentCanceled(): string {
  const content = `
    <section class="mx-auto max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
      <div class="text-5xl mb-4">❌</div>
      <h1 class="text-2xl font-bold text-white">Payment Canceled</h1>
      <p class="mt-4 text-slate-400">You were not charged. You can try again at any time.</p>
      <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <a href="/pricing" class="inline-block rounded-lg bg-emerald-600 px-6 py-2 text-white hover:bg-emerald-500 transition-colors">View Pricing</a>
        <a href="/" class="inline-block rounded-lg border border-slate-700 px-6 py-2 text-slate-300 hover:border-slate-500 transition-colors">Back to Home</a>
      </div>
      <div class="mt-4 text-sm text-slate-500">
        Need help? <a href="/contact" class="text-emerald-400 hover:underline">Contact support</a>
      </div>
    </section>`;

  return Layout(
    content,
    "Payment Canceled",
    { title: "Payment Canceled", description: "Payment was canceled", path: "/payment/canceled" },
    undefined,
    true,
  ) as unknown as string;
}
