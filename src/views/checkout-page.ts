import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { PageMeta } from "../server/lib/page-meta";
import {
  metadataFieldTypesFor,
  type CommerceProduct,
} from "../server/lib/commerce-catalog";
import type { UsdcNetworks } from "../server/lib/payments-api";

/**
 * SLICE-221-4 (D-221-3): server-rendered checkout page — product summary +
 * catalog-driven metadata form + payment-method/network selects. All state
 * transitions happen client-side in /js/checkout.js: create payment → attach
 * attempt → Stripe redirect or USDC instructions → status polling → receipt.
 */

const FIELD_LABELS: Record<string, string> = {
  accountId: "Hedera Account ID",
  name: "Agent name",
  capabilities: "Capabilities",
  endpoint: "Endpoint URL",
  skills: "Skills",
  imageUrl: "Avatar image URL",
  listingId: "Directory listing ID",
};

const FIELD_HINTS: Record<string, string> = {
  accountId: "shard.realm.num (e.g. 0.0.1234) — the passport mints to this account",
  capabilities: "Comma-separated, e.g. api_call,payment",
  skills: "Comma-separated",
  endpoint: "https:// your agent's public endpoint",
  listingId: "ID of the directory listing to activate",
};

function usdPrice(product: CommerceProduct): string {
  return product.prices.find((p) => p.currency === "USD" && p.active)?.amount ?? "0";
}

function hbarPrice(product: CommerceProduct): string | undefined {
  return product.prices.find((p) => p.currency === "HBAR" && p.active)?.amount;
}

function fieldInput(
  name: string,
  type: string,
  required: boolean,
): string {
  const label = FIELD_LABELS[name] ?? name;
  const hint = FIELD_HINTS[name];
  const multi = type === "string[]";
  return `
      <label class="block" for="f-${name}">
        <span class="mb-1 flex items-baseline justify-between text-sm">
          <span class="font-medium text-slate-200">${label}${required ? "" : ' <span class="text-xs text-slate-500">(optional)</span>'}</span>
        </span>
        <input id="f-${name}" name="${name}" type="text"
               ${required ? "required" : ""}
               data-field-type="${type}"
               ${name === "accountId" ? 'pattern="^\\d+\\.\\d+\\.\\d+$" title="Hedera Account ID format: shard.realm.num"' : ""}
               placeholder="${multi ? "value1,value2" : ""}"
               class="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none" />
        ${hint ? `<span class="mt-1 block text-xs text-slate-500">${hint}</span>` : ""}
      </label>`;
}

export interface CheckoutPageOptions {
  /** Pre-selected rail: "card" (STRIPE) or "usdc" (DIRECT_USDC). */
  method?: string;
  /** Pre-selected CAIP-2 network for USDC. */
  network?: string;
}

export function CheckoutPage(
  product: CommerceProduct,
  usdcNetworks: UsdcNetworks,
  opts: CheckoutPageOptions = {},
  jsonLd?: object[],
): string {
  const usd = usdPrice(product);
  const hbar = hbarPrice(product);
  const fieldTypes = metadataFieldTypesFor(product.fulfillmentKind);
  const required = new Set(product.metadataSchema.required);
  const orderedFields = [
    ...product.metadataSchema.required,
    ...product.metadataSchema.optional.filter(
      (f) => !required.has(f),
    ),
  ];
  const fieldsHtml = orderedFields
    .map((f) => fieldInput(f, fieldTypes[f] ?? "string", required.has(f)))
    .join("");

  const networks = Object.entries(usdcNetworks);
  const arcFirst = networks.sort((a, b) =>
    a[1].label === "arc" ? -1 : b[1].label === "arc" ? 1 : 0,
  );
  const method = opts.method === "usdc" ? "usdc" : "card";
  const networkOpts = arcFirst
    .map(([caip2, cfg]) => {
      const sel =
        (opts.network && opts.network === caip2) ||
          (!opts.network && cfg.label === "arc")
          ? " selected"
          : "";
      return `<option value="${caip2}" data-network-label="${cfg.label}"${sel}>${cfg.label === "arc" ? "Arc" : cfg.label === "base" ? "Base" : "Solana"} (USDC)</option>`;
    })
    .join("");

  const content = html`
    <section class="mx-auto max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
      <a href="/pricing" class="text-sm text-sky-400 hover:text-sky-300">← Back to pricing</a>

      <h1 class="mt-4 text-2xl font-semibold text-white">Checkout</h1>

      <div class="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
        <div class="flex items-baseline justify-between gap-4">
          <div>
            <p class="font-medium text-white">${product.name}</p>
            <p class="mt-1 text-sm text-slate-400">${product.description}</p>
          </div>
          <div class="text-right">
            <p class="text-2xl font-semibold text-sky-400">$${usd}</p>
            ${hbar ? `<p class="text-xs text-slate-500">${hbar} HBAR equivalent</p>` : ""}
          </div>
        </div>
      </div>

      <form id="checkout-form" class="mt-6 space-y-4" novalidate
            data-product-code="${product.productCode}">
        ${raw(fieldsHtml)}

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="block" for="f-method">
            <span class="mb-1 block text-sm font-medium text-slate-200">Payment method</span>
            <select id="f-method" name="method"
                    class="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none">
              <option value="card"${method === "card" ? " selected" : ""}>Card (Stripe)</option>
              <option value="usdc"${method === "usdc" ? " selected" : ""}>USDC</option>
            </select>
          </label>
          <label class="block" for="f-network" id="network-wrap">
            <span class="mb-1 block text-sm font-medium text-slate-200">Network</span>
            <select id="f-network" name="network"
                    class="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none">
              ${raw(networkOpts)}
            </select>
          </label>
        </div>

        <button type="submit" id="checkout-submit"
                class="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60">
          Continue to payment
        </button>
      </form>

      <div id="checkout-instructions" class="mt-6 hidden"></div>
      <div id="checkout-status" class="mt-4 hidden text-sm"></div>
      <div id="checkout-receipt" class="mt-6 hidden"></div>
    </section>

    <script src="/js/toast.js?v=1" defer></script>
    <script src="/js/checkout.js?v=1" defer></script>
  `;

  return String(
    Layout(
      content.toString(),
      `Checkout — ${product.name}`,
      PageMeta["/checkout"] ?? {
        title: `Checkout — ${product.name}`,
        description: `Complete your purchase of ${product.name}. Pay by card or USDC.`,
        path: "/checkout",
      },
      jsonLd,
      true, // noindex — transactional page
    ),
  );
}
