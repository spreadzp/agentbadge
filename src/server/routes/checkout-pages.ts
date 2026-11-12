/**
 * SLICE-221-4 (EPIC-221, D-221-3/D-221-7): server-rendered checkout pages.
 *
 * GET /checkout?product=<productCode>&method=card|usdc&network=<caip2>
 *   — product summary + catalog-driven metadata form + method/network selects.
 *   Client orchestration in /js/checkout.js: POST /api/v1/payments →
 *   POST /api/v1/payments/:id/attempts → Stripe redirect or USDC instructions
 *   → status polling → receipt.
 * GET /checkout/qr.svg?data=<payload> — QR code for USDC instructions.
 * GET /checkout/success, /checkout/cancel — Stripe return URLs (D-221-3).
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { toString as qrToString } from "qrcode";

/** Escape user input reflected into server-rendered HTML (C-3). */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

import { getConfig } from "../../config/env";
import {
  getCommerceProduct,
  productCodeForLegacyId,
} from "../lib/commerce-catalog";
import type { UsdcNetworks } from "../lib/payments-api";
import { CheckoutPage } from "../../views/checkout-page";
import { Layout } from "../../views/layout";
import { PageMeta } from "../lib/page-meta";

export interface CheckoutPageRouteDeps {
  /** USDC network map (CAIP-2 → config). Defaults to live config. */
  usdcNetworks?: UsdcNetworks;
}

function resolveUsdcNetworks(deps?: CheckoutPageRouteDeps): UsdcNetworks {
  if (deps?.usdcNetworks) return deps.usdcNetworks;
  return getConfig().payments.usdcNetworks;
}

function simplePage(title: string, bodyHtml: string): string {
  const content = `
    <section class="mx-auto max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
      ${bodyHtml}
      <p class="mt-6"><a href="/pricing" class="text-sky-400 hover:text-sky-300">← Back to pricing</a></p>
    </section>`;
  return String(
    Layout(
      content,
      title,
      PageMeta["/checkout"] ?? { title, description: title, path: "/checkout" },
      undefined,
      true,
    ),
  );
}

export function createCheckoutPageRoutes(
  deps?: CheckoutPageRouteDeps,
): Hono {
  const routes = new Hono();

  routes.get(
    "/checkout",
    describeRoute({
      tags: ["Content"],
      summary: "Checkout page",
      description:
        "Server-rendered checkout: product summary, metadata form per catalog schema, payment-method (Card/USDC) and network (Arc/Base/Solana) selects. Client JS drives POST /api/v1/payments → attempts → instructions/status/receipt.",
      responses: {
        200: { description: "HTML checkout page" },
        404: { description: "Unknown product" },
      },
    }),
    (c) => {
      const rawCode = c.req.query("product")?.trim() ?? "";
      const code = productCodeForLegacyId(rawCode) ?? rawCode.toUpperCase();
      const product = code ? getCommerceProduct(code) : undefined;
      if (!product || !product.active) {
        return c.html(
          simplePage(
            "Checkout — product not found",
            `<h1 class="text-xl font-semibold text-white">Product not found</h1>
             <p class="mt-3 text-sm text-slate-400">The product "${esc(rawCode) || "?"}" is not available for checkout.</p>`,
          ),
          404,
        );
      }
      const method = c.req.query("method");
      const network = c.req.query("network");
      return c.html(
        CheckoutPage(product, resolveUsdcNetworks(deps), {
          method: method ?? undefined,
          network: network ?? undefined,
        }),
      );
    },
  );

  routes.get(
    "/checkout/qr.svg",
    describeRoute({
      tags: ["Payments"],
      summary: "QR code for checkout instructions",
      description:
        "Renders an SVG QR code for the `data` payload (USDC recipient/reference text for wallet scans).",
      responses: {
        200: { description: "SVG QR code" },
        400: { description: "Missing data param" },
      },
    }),
    async (c) => {
      const data = c.req.query("data")?.trim();
      // M-2: cap by BYTES (a 2000-char multi-byte payload is oversized),
      // and a renderer failure must not surface as an unhandled 500.
      if (!data || Buffer.byteLength(data, "utf8") > 512) {
        return c.json({ error: "missing or oversized data param" }, 400);
      }
      let svg: string;
      try {
        svg = await qrToString(data, { type: "svg", margin: 2 });
      } catch {
        return c.json({ error: "invalid qr payload" }, 400);
      }
      return c.body(svg, 200, {
        "Content-Type": "image/svg+xml",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      });
    },
  );

  routes.get(
    "/checkout/success",
    describeRoute({
      tags: ["Content"],
      summary: "Checkout success return page",
      responses: { 200: { description: "HTML success page" } },
    }),
    (c) =>
      c.html(
        simplePage(
          "Payment successful",
          `<h1 class="text-xl font-semibold text-white">Payment successful</h1>
           <p class="mt-3 text-sm text-slate-400">Your payment was received. Fulfillment runs automatically — your passport mint or listing activation completes within a few minutes.</p>`,
        ),
      ),
  );

  routes.get(
    "/checkout/cancel",
    describeRoute({
      tags: ["Content"],
      summary: "Checkout cancel return page",
      responses: { 200: { description: "HTML cancel page" } },
    }),
    (c) =>
      c.html(
        simplePage(
          "Checkout canceled",
          `<h1 class="text-xl font-semibold text-white">Checkout canceled</h1>
           <p class="mt-3 text-sm text-slate-400">No charge was made. You can restart checkout any time.</p>`,
        ),
      ),
  );

  return routes;
}

export const checkoutPageRoutes = createCheckoutPageRoutes();
