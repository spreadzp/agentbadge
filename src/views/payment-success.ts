/**
 * Payment success page view.
 *
 * SLICE-67-5: Confirmation page shown after Stripe checkout redirect.
 */

import { Layout } from "./layout";

/** M-7: every session-derived value is reflected HTML — escape it. */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SessionData {
  id: string;
  status?: string | null;
  customer_email?: string | null;
  amount_total?: number | null;
  metadata?: Record<string, string> | null;
}

export function renderPaymentSuccess(session: SessionData, fallback: boolean): string {
  const amountFormatted = session.amount_total
    ? `$${(session.amount_total / 100).toFixed(2)}`
    : null;

  const emailRow = session.customer_email
    ? `<div class="text-slate-400">Email: <span class="text-slate-200">${esc(session.customer_email)}</span></div>`
    : "";

  const amountRow = amountFormatted
    ? `<div class="text-slate-400">Amount: <span class="text-slate-200">${amountFormatted}</span></div>`
    : "";

  const productRow = session.metadata?.productId
    ? `<div class="text-slate-400">Product: <span class="text-slate-200">${esc(session.metadata.productId)}</span></div>`
    : "";

  const note = fallback
    ? `<div class="mt-4 rounded-lg border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-300">
        Your payment may still be processing. If you believe this is an error, please contact support.
      </div>`
    : `<div class="mt-4 text-sm text-emerald-400">Your order is being fulfilled. You will receive confirmation shortly.</div>`;

  const content = `
    <section class="mx-auto max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
      <div class="text-5xl mb-4">✅</div>
      <h1 class="text-2xl font-bold text-white">Payment Successful!</h1>
      <div class="mt-6 space-y-2 text-left">
        ${productRow}
        ${amountRow}
        ${emailRow}
        <div class="text-slate-400">Session ID: <span class="text-slate-200 break-all">${esc(session.id)}</span></div>
      </div>
      ${note}
      <div class="mt-6">
        <a href="/" class="inline-block rounded-lg bg-emerald-600 px-6 py-2 text-white hover:bg-emerald-500 transition-colors">Back to Home</a>
      </div>
    </section>`;

  return Layout(
    content,
    "Payment Successful",
    { title: "Payment Successful", description: "Payment confirmation", path: "/payment/success" },
    undefined,
    true,
  ) as unknown as string;
}

export function renderPaymentError(title: string, message: string): string {
  const content = `
    <section class="mx-auto max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
      <div class="text-5xl mb-4">⚠️</div>
      <h1 class="text-2xl font-bold text-white">${esc(title)}</h1>
      <p class="mt-4 text-slate-400">${esc(message)}</p>
      <div class="mt-6">
        <a href="/" class="inline-block rounded-lg bg-emerald-600 px-6 py-2 text-white hover:bg-emerald-500 transition-colors">Back to Home</a>
      </div>
    </section>`;

  return Layout(
    content,
    esc(title),
    { title: esc(title), description: esc(message), path: "/payment/success" },
    undefined,
    true,
  ) as unknown as string;
}
