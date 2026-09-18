/**
 * SLICE-129-23: demo endpoints pair — identical paid resource,
 * verified (identity ext) vs raw (no ext).
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createCirclePaymentsRuntime } from "../src/server/lib/circle-payments";
import { createDemoRoutes } from "../src/server/routes/demo";
import type { CirclePaymentsConfig } from "../src/config/env";

const SELLER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";

const CFG: CirclePaymentsConfig = {
  enabled: true,
  gateway: false,
  arc: false,
  identity: true,
  escrow: false,
  gatewayApiUrl: "https://gateway-api-testnet.circle.com",
  arcRpcUrl: "https://rpc.testnet.arc.network",
  arcChainId: 5042002,
  sellerAddress: SELLER,
  platformFeeBps: 0,
};

function fakeHandle() {
  return {
    verify: vi.fn().mockResolvedValue({ isValid: true, payer: AGENT }),
    settle: vi
      .fn()
      .mockResolvedValue({ success: true, transaction: "0xtx", payer: AGENT }),
  };
}

function decode402(res: Response) {
  const h = res.headers.get("PAYMENT-REQUIRED");
  expect(h).toBeTruthy();
  return JSON.parse(Buffer.from(h!, "base64").toString("utf-8"));
}

function buildApp(lookup?: (a: string) => Promise<unknown>) {
  const rt = createCirclePaymentsRuntime(CFG, {
    handles: { exact: fakeHandle() },
    ...(lookup ? { identityLookup: lookup as never } : {}),
  });
  const app = new Hono();
  app.route(
    "/",
    createDemoRoutes({
      verifiedPayment: rt.paymentFor("demo.data"),
      rawPayment: rt.paymentFor("demo.data", { identity: false }),
    }),
  );
  return app;
}

describe("demo endpoints pair", () => {
  it("both endpoints → 402 with identical pricing", async () => {
    const app = buildApp();
    const v = await app.request("/api/demo/verified-data");
    const r = await app.request("/api/demo/raw-data");
    expect(v.status).toBe(402);
    expect(r.status).toBe(402);
    const vPr = decode402(v);
    const rPr = decode402(r);
    expect(vPr.accepts.map((a: { amount: string }) => a.amount)).toEqual(
      rPr.accepts.map((a: { amount: string }) => a.amount),
    );
    expect(vPr.accepts[0].amount).toBe("1000"); // $0.001
  });

  it("verified carries identity extension, raw does not", async () => {
    const app = buildApp(async () => ({
      passportTokenId: "0.0.12345",
      readinessScore: 87,
    }));
    const v = decode402(await app.request("/api/demo/verified-data"));
    const r = decode402(await app.request("/api/demo/raw-data"));
    expect(v.extensions?.agentbadge).toBeTruthy();
    expect(v.extensions?.agentbadge?.passportTokenId).toBe("0.0.12345");
    expect(r.extensions?.agentbadge).toBeUndefined();
  });

  it("paid request → 200 + identical payload shape", async () => {
    const app = buildApp();
    // craft a payment the fake handle accepts
    const v = await app.request("/api/demo/verified-data");
    const pr = decode402(v);
    const header = Buffer.from(
      JSON.stringify({
        x402Version: pr.x402Version ?? 2,
        resource: pr.resource,
        accepted: pr.accepts[0],
        payload: { signature: "0xabc" },
      }),
    ).toString("base64");
    for (const path of ["/api/demo/verified-data", "/api/demo/raw-data"]) {
      const res = await app.request(path, {
        headers: { "Payment-Signature": header },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toContain("agent-readiness");
      expect(body.source).toBe("agentbadge-demo");
    }
  });
});
