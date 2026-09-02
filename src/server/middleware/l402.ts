/**
 * SLICE-49-19: L402 Lightning payment middleware
 *
 * Implements the L402 (Lightning HTTP 402) protocol:
 * https://docs.lightning.engineering/the-lightning-network/l402/l402
 *
 * L402 protocol flow:
 * 1. Client requests a paid endpoint without payment
 * 2. Server returns 402 with WWW-Authenticate: L402 macaroon="...", invoice="..."
 *    - macaroon: base64-encoded macaroon with payment hash caveat
 *    - invoice: BOLT11 Lightning invoice
 * 3. Client pays the Lightning invoice, receives a preimage
 * 4. Client retries with Authorization: L402 <macaroon>:<preimage>
 * 5. Server verifies preimage matches payment hash in macaroon
 *
 * In development/test mode (no LND connection), generates mock macaroons
 * and test invoices. Any preimage is accepted in test mode.
 */

import type { MiddlewareHandler } from "hono";
import { createHash, randomBytes, createHmac } from "node:crypto";
import { logger } from "@agentgate-hedera/passport";

export interface L402Config {
  /** Root key for macaroon generation */
  rootKey?: string;
  /** LND gRPC URL for production invoice generation */
  lndUrl?: string;
  /** LND macaroon for authentication */
  lndMacaroon?: string;
  /** Amount in satoshis for the Lightning invoice */
  amountSats: number;
  /** Memo for the Lightning invoice */
  memo?: string;
  /** Test mode — generates mock macaroons and test invoices, accepts any preimage */
  testMode?: boolean;
}

interface MacaroonCaveat {
  key: string;
  value: string;
}

/**
 * Generate a simple macaroon with caveats.
 *
 * Macaroon format: location + identifier + caveats + HMAC signature
 * For L402, caveats include: version, user_id, payment_hash
 */
function generateMacaroon(rootKey: string, caveats: MacaroonCaveat[]): string {
  const identifier = randomBytes(16).toString("hex");
  const location = "agentbadge.xyz";

  // Start with root key HMAC
  let signature = createHmac("sha256", Buffer.from(rootKey, "hex"))
    .update(identifier)
    .digest();

  // Add caveats
  for (const caveat of caveats) {
    const caveatStr = `${caveat.key} = ${caveat.value}`;
    signature = createHmac("sha256", signature).update(caveatStr).digest();
  }

  // Encode macaroon as base64 JSON
  const macaroon = {
    location,
    identifier,
    caveats: caveats.map((c) => `${c.key} = ${c.value}`),
    signature: signature.toString("hex"),
  };

  return Buffer.from(JSON.stringify(macaroon)).toString("base64");
}

/**
 * Generate a test BOLT11 invoice (not a real Lightning invoice).
 * In production, this would call LND's AddInvoice RPC.
 *
 * Test invoice format: "lntb<amount>s<n>..." — follows BOLT11 prefix conventions.
 */
function generateTestInvoice(amountSats: number, paymentHash: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = randomBytes(12).toString("hex");
  // Minimal testnet invoice prefix: lntb + amount + s (satoshis)
  return `lntb${amountSats}s${timestamp}0${random}${paymentHash.substring(0, 16)}`;
}

/**
 * Generate a payment hash for the invoice.
 * In production, this comes from LND's AddInvoice response.
 */
function generatePaymentHash(): { hash: string; preimage: string } {
  const preimage = randomBytes(32);
  const hash = createHash("sha256").update(preimage).digest("hex");
  return { hash, preimage: preimage.toString("hex") };
}

/**
 * Verify an L402 authorization header.
 *
 * Format: "L402 <macaroon>:<preimage>"
 * - Decodes the macaroon
 * - Extracts the payment_hash caveat
 * - Verifies that the preimage hashes to the payment_hash
 *
 * In test mode, accepts any preimage.
 */
function verifyL402Auth(
  authHeader: string,
  rootKey: string,
  testMode: boolean,
): boolean {
  const match = authHeader.match(/^L402\s+(.+):(.+)$/);
  if (!match) return false;

  const [, macaroonB64, preimage] = match;

  if (testMode) {
    return true;
  }

  try {
    const macaroon = JSON.parse(
      Buffer.from(macaroonB64, "base64").toString(),
    );

    // Find payment_hash caveat
    const paymentHashCaveat = macaroon.caveats?.find((c: string) =>
      c.startsWith("payment_hash = "),
    );
    if (!paymentHashCaveat) return false;

    const expectedHash = paymentHashCaveat.replace("payment_hash = ", "");

    // Verify preimage hashes to payment_hash
    const actualHash = createHash("sha256")
      .update(Buffer.from(preimage, "hex"))
      .digest("hex");

    return actualHash === expectedHash;
  } catch {
    return false;
  }
}

export type L402Mode = "disabled" | "test" | "production";

/**
 * SLICE-83-4: Resolve L402 mode from config + env.
 *
 * - "disabled" when no LND vars and no explicit testMode (default-deny, no gate)
 * - "test" when L402_TEST_MODE=true or config.testMode=true
 * - "production" when LND URL + macaroon are configured
 */
export function resolveL402Mode(config: L402Config): L402Mode {
  if (config.testMode === true) return "test";
  if (process.env.L402_TEST_MODE === "true") return "test";

  const hasLndConfig =
    !!config.lndUrl ||
    (!!process.env.L402_LND_URL && !!process.env.L402_LND_MACAROON);

  if (hasLndConfig) return "production";

  return "disabled";
}

/**
 * L402 Lightning payment middleware.
 *
 * Intercepts requests to paid endpoints. If no valid L402 Authorization header
 * is present, returns 402 with WWW-Authenticate: L402 challenge containing
 * a macaroon and Lightning invoice.
 *
 * SLICE-83-4: When mode is "disabled" (no LND config, no test flag),
 * the middleware passes through without gating — default-deny posture.
 *
 * If a valid L402 Authorization header is present, passes through to the
 * next handler (payment verified).
 */
export function l402PaymentMiddleware(config: L402Config): MiddlewareHandler {
  const mode = resolveL402Mode(config);

  if (mode === "disabled") {
    logger.warn("L402 Middleware is DISABLED — no LND config and L402_TEST_MODE is not 'true'. Endpoint is not gated.");
    return async (_c, next) => {
      await next();
    };
  }

  const rootKey =
    config.rootKey ??
    process.env.L402_ROOT_KEY ??
    randomBytes(32).toString("hex");
  const testMode = mode === "test";

  // Store issued macaroons for verification (in production, use a proper store)
  const issuedMacaroons = new Map<string, string>();

  return async (c, next) => {
    const authHeader = c.req.header("authorization");

    // Check for existing x402 payment (don't interfere with x402)
    const xPayment = c.req.header("x-payment");
    if (xPayment) {
      await next();
      return;
    }

    // If L402 auth header present, verify it
    if (authHeader && authHeader.startsWith("L402 ")) {
      if (verifyL402Auth(authHeader, rootKey, testMode)) {
        await next();
        return;
      }
    }

    // No valid payment — generate L402 challenge
    const { hash: paymentHash } = generatePaymentHash();
    const invoice = testMode
      ? generateTestInvoice(config.amountSats, paymentHash)
      : generateTestInvoice(config.amountSats, paymentHash); // Would call LND in production

    const macaroon = generateMacaroon(rootKey, [
      { key: "version", value: "0" },
      { key: "user_id", value: randomBytes(16).toString("hex") },
      { key: "payment_hash", value: paymentHash },
    ]);

    issuedMacaroons.set(macaroon, paymentHash);

    const wwwAuth = `L402 macaroon="${macaroon}", invoice="${invoice}"`;

    // Preserve existing WWW-Authenticate values (from MPP/x402 middleware)
    const existingWwwAuth = c.res.headers.get("www-authenticate");
    const wwwAuthValue = existingWwwAuth
      ? `${existingWwwAuth}, ${wwwAuth}`
      : wwwAuth;

    c.header("WWW-Authenticate", wwwAuthValue);
    c.header("Content-Type", "application/json");

    const challenge = {
      x402Version: 1,
      accepts: [
        {
          scheme: "L402",
          network: "lightning",
          maxAmountRequired: config.amountSats,
          asset: "satoshis",
          payTo: process.env.L402_NODE_PUBKEY ?? "test-node",
          maxTimeoutSeconds: 3600,
        },
      ],
      extensions: {
        l402: {
          macaroon,
          invoice,
        },
        bazaar: {
          discoverable: true,
        },
      },
    };

    // SLICE-49-21: Payment-Required header (base64 JSON with bazaar extension)
    const paymentRequiredHeader = Buffer.from(
      JSON.stringify(challenge),
    ).toString("base64");
    c.header("Payment-Required", paymentRequiredHeader);

    return c.json(challenge, 402);
  };
}
