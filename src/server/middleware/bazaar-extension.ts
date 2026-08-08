/**
 * SLICE-49-21: Bazaar extension middleware
 *
 * Intercepts any 402 response and injects `extensions.bazaar.discoverable: true`
 * into the JSON body, the base64 Payment-Required header, and adds
 * WWW-Authenticate: Payment header if not already present.
 *
 * This ensures Bazaar discovery works regardless of which payment
 * middleware produced the 402 (x402, MPP, or custom).
 */

import type { MiddlewareHandler } from "hono";

const BAZAAR_EXTENSION = {
  bazaar: {
    discoverable: true,
  },
};

/**
 * Middleware that injects Bazaar extensions into any 402 response.
 *
 * Runs after route handlers. If the response status is 402:
 * - Adds `extensions.bazaar.discoverable: true` to the JSON body
 * - Updates the base64 Payment-Required header to include bazaar
 * - Adds WWW-Authenticate: Payment header if not present
 */
export function bazaarExtensionMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    if (c.res.status !== 402) {
      return;
    }

    const contentType = c.res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        const body = await c.res.json();
        if (!body.extensions) {
          body.extensions = {};
        }
        if (!body.extensions.bazaar) {
          body.extensions.bazaar = BAZAAR_EXTENSION.bazaar;
        }
        c.res = c.json(body, 402);
      } catch {
        // Body is not valid JSON, skip
      }
    }

    let paymentHeader = c.res.headers.get("payment-required");
    if (paymentHeader) {
      try {
        const decoded = JSON.parse(
          Buffer.from(paymentHeader, "base64").toString(),
        );
        if (!decoded.extensions) {
          decoded.extensions = {};
        }
        if (!decoded.extensions.bazaar) {
          decoded.extensions.bazaar = BAZAAR_EXTENSION.bazaar;
        }
        c.res.headers.set(
          "payment-required",
          Buffer.from(JSON.stringify(decoded)).toString("base64"),
        );
      } catch {
        // Header is not valid base64 JSON, skip
      }
    } else {
      const challenge = {
        x402Version: 1,
        accepts: [],
        extensions: { bazaar: BAZAAR_EXTENSION.bazaar },
      };
      c.res.headers.set(
        "payment-required",
        Buffer.from(JSON.stringify(challenge)).toString("base64"),
      );
    }

    if (!c.res.headers.get("www-authenticate")) {
      c.res.headers.set(
        "www-authenticate",
        `Payment method="tempo", request="${c.res.headers.get("payment-required")}"`,
      );
    }
  };
}
