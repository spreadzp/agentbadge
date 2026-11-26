import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { importPKCS8, SignJWT } from "jose";

import { BASE_URL } from "../../lib/page-meta";
import {
  didKeyMaterialFromEnv,
  DID_VM_FRAGMENT,
} from "../../lib/agent-discovery/did-key";

export const x402DiscoveryRoutes = new Hono();

// SLICE-259-40 (AB-190): signed offer-receipt inside /.well-known/x402.json —
// the offer object signed by the DID key (format: jws). Gated on
// DID_SIGNING_KEY; absent when unsigned (honest absence, not a fake).
let offerReceiptCache: Promise<Record<string, unknown> | null> | null = null;
function signedOfferReceipt(arcNetwork: string): Promise<Record<string, unknown> | null> {
  if (offerReceiptCache) return offerReceiptCache;
  offerReceiptCache = (async () => {
    const material = didKeyMaterialFromEnv();
    if (!material) return null;
    const host = new URL(BASE_URL).host;
    const kid = `did:web:${host}${DID_VM_FRAGMENT}`;
    const offer = {
      issuer: `did:web:${host}`,
      service: "demo-scan-lite",
      endpoint: "GET /api/v1/demo/scan-lite",
      asset: "USDC",
      network: arcNetwork,
      price: "0.001",
      terms: "per-call settlement; no subscription; receipt issued on payment",
    };
    const key = await importPKCS8(material.pkcs8, "EdDSA");
    const signature = await new SignJWT({ offer })
      .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
      .setIssuer(`did:web:${host}`)
      .setIssuedAt()
      .setExpirationTime("365d")
      .sign(key);
    return {
      info: {
        spec: "Signed machine-readable offer — receipt of the published price/terms for the demo scan rail.",
        offers: [{ format: "jws", signature, offer }],
      },
    };
  })().catch(() => null);
  return offerReceiptCache;
}

// ─── x402 payment discovery (SLICE-47-10) ──────────────────────

x402DiscoveryRoutes.get(
  "/.well-known/x402.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "x402 payment discovery",
    description:
      "Returns the site's x402 payment configuration: supported network, facilitator, payTo wallet, and list of paid services with pricing.",
    responses: {
      200: {
        description: "x402 payment configuration",
        content: { "application/json": {} },
      },
    },
  }),
  async (c) => {
    const facilitatorUrl = process.env.x402_FACILITATOR_URL ?? "https://facilitator-agentbadge.fly.dev";
    const payTo = process.env.X402_PAY_TO ?? process.env.x402_TREASURY ?? "";
    // CAIP-2 the pilots/rails actually charge on — same env the
    // gateway registry uses (X402_GATEWAY_NETWORK), else ARC_CHAIN_ID.
    const arcNetwork =
      process.env.X402_GATEWAY_NETWORK ??
      `eip155:${process.env.ARC_CHAIN_ID ?? "5042002"}`;

    // Advertise only rails that are actually mounted: marketplace +
    // scan gates always (they fail closed without runtime), EPIC-223
    // pilots only when the gateway flag is on.
    const services: Array<Record<string, unknown>> = [
      {
        method: "GET",
        path: "/api/v1/demo/scan-lite",
        description:
          "One-page agent-readiness probe — USDC on Arc via circle-payments",
        amount: { asset: "USDC", network: arcNetwork, price: "0.001" },
        mimeType: "application/json",
        extensions: {
          bazaar: {
            discoverable: true,
            category: "scan",
            tags: ["arc", "usdc", "agent-readiness", "demo", "x402"],
          },
        },
      },
      {
        method: "POST",
        path: "/api/total-scan",
        description:
          "Agent-readiness scan, priced per selected rule bundle — multi-chain accepts",
        amount: { asset: "USDC", network: arcNetwork },
        mimeType: "application/json",
        extensions: {
          bazaar: {
            discoverable: true,
            category: "scan",
            tags: ["arc", "usdc", "agent-readiness", "scan", "x402"],
          },
        },
      },
      {
        method: "POST",
        path: "/api/market/passport",
        description:
          "Marketplace passport mint — USDC via circle-payments PaymentRouter",
        amount: { asset: "USDC", network: arcNetwork },
        mimeType: "application/json",
        extensions: {
          bazaar: {
            discoverable: true,
            category: "identity",
            tags: ["arc", "usdc", "passport", "marketplace", "x402"],
          },
        },
      },
    ];

    if (process.env.X402_GATEWAY_ENABLED === "true") {
      services.push(
        {
          method: "POST",
          path: "/api/v1/passport/request",
          description:
            "Agent Passport issuance — USDC on Arc via x402 gateway (EPIC-223 pilot)",
          amount: { asset: "USDC", network: arcNetwork, price: "0.10" },
          mimeType: "application/json",
          extensions: {
            bazaar: {
              discoverable: true,
              category: "identity",
              tags: ["arc", "usdc", "passport", "agent-identity", "x402"],
            },
          },
        },
        {
          method: "GET",
          path: "/api/v1/fx/delta/premium",
          description:
            "Premium FX-delta snapshot — USDC on Arc via x402 gateway (EPIC-223 pilot)",
          amount: { asset: "USDC", network: arcNetwork, price: "0.02" },
          mimeType: "application/json",
          extensions: {
            bazaar: {
              discoverable: true,
              category: "data",
              tags: ["arc", "usdc", "fx", "premium", "x402"],
            },
          },
        },
      );
    }

    const offerReceipt = await signedOfferReceipt(arcNetwork);
    const config = {
      x402Version: 1,
      name: "AgentBadge",
      network: arcNetwork,
      facilitator: facilitatorUrl,
      payTo,
      services,
      extensions: {
        bazaar: {
          discoverable: true,
          provider: "AgentBadge",
          homepage: "https://agentbadge.xyz",
        },
        // SLICE-259-40 (AB-190): signed offer — verifiable price/terms
        // commitment; omitted when DID_SIGNING_KEY is unset.
        ...(offerReceipt ? { "offer-receipt": offerReceipt } : {}),
      },
    };

    return c.json(config, 200, {
      "Cache-Control": "public, max-age=300",
    });
  },
);

// Alias: clients probe `/.well-known/x402` (no .json) — redirect instead of 404.
x402DiscoveryRoutes.get("/.well-known/x402", (c) =>
  c.redirect("/.well-known/x402.json", 301),
);

