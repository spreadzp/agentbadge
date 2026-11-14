import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequirements as X402PaymentRequirements,
} from "@x402/core/types";
import {
  ARC_TESTNET_CAIP2,
  ARC_TESTNET_USDC,
  pilotResources,
  usdToUsdcAtomic,
} from "@agentbadge/payments";

import {
  X402_PAYMENT_KEY,
  X402_VERSION,
  domainToAcceptEntry,
  parsePaymentSignature,
  paymentRequiredHeader,
  paymentResponseHeader,
  settleResponseFrom,
  x402Middleware,
  type X402GatewayDeps,
} from "../../src/server/lib/x402-gateway/protocol.js";
import type { SettleSeamResult } from "../../src/server/lib/x402-settle-seam.js";

const [RESOURCE] = pilotResources(ARC_TESTNET_CAIP2);

const ACCEPT: X402PaymentRequirements = {
  scheme: "exact",
  network: ARC_TESTNET_CAIP2,
  asset: ARC_TESTNET_USDC,
  amount: "100000",
  payTo: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
  maxTimeoutSeconds: 60,
  extra: {},
};

const SEAM_RESULT: SettleSeamResult = {
  payer: "0x1111111111111111111111111111111111111111",
  amountAtomic: "100000",
  tx: "0xdeadbeef",
  sourceChain: ARC_TESTNET_CAIP2,
  scheme: "exact",
};

const mkDeps = (
  over: Partial<X402GatewayDeps> = {},
): X402GatewayDeps => ({
  getResource: () => RESOURCE!,
  acceptsFor: () => [ACCEPT],
  seam: async () => SEAM_RESULT,
  ...over,
});

describe("protocol headers — official encoders", () => {
  it("paymentRequiredHeader round-trips via official decoder", () => {
    const h = paymentRequiredHeader({
      accepts: [ACCEPT],
      resource: {
        url: "https://agentbadge.xyz/api/v1/passport/request",
        description: RESOURCE!.description,
        mimeType: "application/json",
      },
    });
    const decoded = decodePaymentRequiredHeader(h);
    expect(decoded.x402Version).toBe(X402_VERSION);
    expect(decoded.accepts).toHaveLength(1);
    expect(decoded.accepts[0]!.payTo).toBe(ACCEPT.payTo);
    expect(decoded.resource.url).toContain("/api/v1/passport/request");
  });

  it("parsePaymentSignature decodes official-encoded payload", () => {
    const payload: PaymentPayload = {
      x402Version: X402_VERSION,
      accepted: ACCEPT,
      payload: { signature: "0xsig" },
    };
    const header = encodePaymentSignatureHeader(payload);
    const parsed = parsePaymentSignature(header);
    expect(parsed).not.toBeNull();
    expect(parsed!.accepted.payTo).toBe(ACCEPT.payTo);
    expect(parsed!.payload["signature"]).toBe("0xsig");
  });

  it("parsePaymentSignature → null on garbage/missing", () => {
    expect(parsePaymentSignature("not-base64!!!")).toBeNull();
    expect(parsePaymentSignature(undefined)).toBeNull();
    expect(parsePaymentSignature(null)).toBeNull();
  });

  it("paymentResponseHeader round-trips via official decoder", () => {
    const settle = settleResponseFrom(SEAM_RESULT);
    const h = paymentResponseHeader(settle);
    const decoded = decodePaymentResponseHeader(h);
    expect(decoded.success).toBe(true);
    expect(decoded.transaction).toBe("0xdeadbeef");
    expect(decoded.payer).toBe(SEAM_RESULT.payer);
    expect(decoded.amount).toBe("100000");
  });
});

describe("domain ↔ protocol adapters", () => {
  it("domainToAcceptEntry maps domain requirements", () => {
    const entry = domainToAcceptEntry(
      {
        resourceId: RESOURCE!.id,
        amount: usdToUsdcAtomic(RESOURCE!.priceUsd),
        currency: "USDC",
        network: RESOURCE!.network,
        recipient: ACCEPT.payTo,
        description: RESOURCE!.description,
      },
      { scheme: "exact", asset: ARC_TESTNET_USDC },
    );
    expect(entry.scheme).toBe("exact");
    expect(entry.network).toBe(ARC_TESTNET_CAIP2);
    expect(entry.asset).toBe(ARC_TESTNET_USDC);
    expect(entry.amount).toBe("100000");
    expect(entry.payTo).toBe(ACCEPT.payTo);
    expect(entry.extra?.["resourceId"]).toBe("passport-request");
  });
});

describe("x402Middleware", () => {
  const mkApp = (deps: X402GatewayDeps) => {
    const app = new Hono<{
      Variables: { x402Payment: SettleSeamResult };
    }>();
    app.use("/paid", x402Middleware("passport-request", deps));
    app.get("/paid", (c) =>
      c.json({ payer: c.get(X402_PAYMENT_KEY).payer }),
    );
    return app;
  };

  it("no payment header → 402 + spec PAYMENT-REQUIRED", async () => {
    const res = await mkApp(mkDeps()).request("http://x/paid");
    expect(res.status).toBe(402);
    const h = res.headers.get("PAYMENT-REQUIRED");
    expect(h).toBeTruthy();
    const decoded = decodePaymentRequiredHeader(h!);
    expect(decoded.accepts[0]!.amount).toBe("100000");
    expect(decoded.resource.url).toBe("http://x/paid");
  });

  it("signature + seam ok → 200 + PAYMENT-RESPONSE + ctx + hook", async () => {
    const onSettled = vi.fn();
    const app = mkApp(mkDeps({ onSettled }));
    const sig = encodePaymentSignatureHeader({
      x402Version: X402_VERSION,
      accepted: ACCEPT,
      payload: { signature: "0xsig" },
    });
    const res = await app.request("http://x/paid", {
      headers: { "payment-signature": sig },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(await res.json()).toEqual({ payer: SEAM_RESULT.payer });
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("signature + seam null → 402", async () => {
    const res = await mkApp(
      mkDeps({ seam: async () => null }),
    ).request("http://x/paid", {
      headers: { "payment-signature": "anything" },
    });
    expect(res.status).toBe(402);
  });

  it("unconfigured resource → 500", async () => {
    const res = await mkApp(
      mkDeps({ getResource: () => null }),
    ).request("http://x/paid");
    expect(res.status).toBe(500);
  });
});
