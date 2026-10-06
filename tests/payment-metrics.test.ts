/**
 * SLICE-160-1 (server side): metrics/payments.ts registry + wiring.
 * - counters/histograms/gauges exist under agentbadge_payments_* /
 *   agentbadge_gateway_* / agentbadge_facilitator_up / agentbadge_route_price_usd
 * - hooks from createPaymentMetrics() increment prom series
 * - label whitelist (D2-160): rail/network/result/reason_class/route_key/target only
 * - runtime wiring: deps.metrics flows into routers; onFailure composes
 *   paymentsFailuresTotal with normalized reason_class; route key → price gauge.
 */
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  createPaymentMetrics,
  classifyReason,
  paymentsVerifyTotal,
  paymentsSettleTotal,
  gatewayTransfersPending,
  facilitatorUp,
  routePriceUsd,
  registry,
} from "../src/server/metrics/payments";
import { createCirclePaymentsRuntime } from "../src/server/lib/circle-payments";
import type { CirclePaymentsConfig } from "../src/config/env";

const SELLER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";

const BASE_CFG: CirclePaymentsConfig = {
  enabled: true,
  gateway: false,
  arc: false,
  identity: false,
  escrow: false,
  gatewayApiUrl: "https://gateway-api-testnet.circle.com",
  arcRpcUrl: "https://rpc.testnet.arc.network",
  arcChainId: 5042002,
  arcMainnet: false,
  arcMainnetRpcUrl: "https://rpc.mainnet.arc.io",
  gatewayMinDepositUsd: "0.10",
  attestation: false,
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

const PAID_HEADERS = {
  "payment-signature": Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:84532",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        extra: { name: "USDC", version: "2" },
      },
      payload: {},
    }),
  ).toString("base64"),
};

async function exposition(): Promise<string> {
  return registry.metrics();
}

describe("metrics/payments.ts", () => {
  it("exposes payments counters/histograms in registry exposition", async () => {
    const text = await exposition();
    expect(text).toContain("agentbadge_payments_verify_total");
    expect(text).toContain("agentbadge_payments_settle_total");
    expect(text).toContain("agentbadge_payments_verify_duration_ms");
    expect(text).toContain("agentbadge_payments_settle_duration_ms");
    expect(text).toContain("agentbadge_payments_failures_total");
    expect(text).toContain("agentbadge_gateway_transfers_pending");
    expect(text).toContain("agentbadge_gateway_time_to_settle_seconds");
    expect(text).toContain("agentbadge_route_price_usd");
    expect(text).toContain("agentbadge_facilitator_up");
  });

  it("hooks increment verify/settle counters and observe durations", async () => {
    const m = createPaymentMetrics();
    const before = await exposition();
    m.hooks.onVerify!("exact", "eip155:84532", "ok", 12);
    m.hooks.onSettle!("exact", "eip155:84532", "ok", 34);
    const after = await exposition();
    const vLine = after
      .split("\n")
      .find(
        (l) =>
          l.startsWith("agentbadge_payments_verify_total") &&
          l.includes('rail="exact"'),
      );
    expect(vLine).toBeTruthy();
    const bLine = before
      .split("\n")
      .find(
        (l) =>
          l.startsWith("agentbadge_payments_verify_total") &&
          l.includes('rail="exact"') &&
          l.includes('result="ok"'),
      );
    expect(Number(vLine!.trim().split(" ").pop())).toBeGreaterThan(
      bLine ? Number(bLine.trim().split(" ").pop()) : 0,
    );
  });

  it("classifyReason normalizes failure reasons into whitelist classes", () => {
    expect(classifyReason("request timed out after 30s")).toBe("timeout");
    expect(classifyReason("ETIMEDOUT connecting")).toBe("timeout");
    expect(classifyReason("fulfillment handler threw")).toBe("fulfillment");
    expect(classifyReason("facilitator returned 502")).toBe("provider");
    expect(classifyReason("some opaque failure")).toBe("other");
  });

  it("gauges/histograms writable: pending, facilitatorUp, route price, settle lag", async () => {
    gatewayTransfersPending.set(3);
    facilitatorUp.set({ target: "gateway" }, 1);
    routePriceUsd.set({ route_key: "readiness.scan" }, 0.01);
    const text = await exposition();
    // registry sets default label service="agentbadge" — match by prefix
    expect(text).toMatch(/agentbadge_gateway_transfers_pending\{[^}]*\} 3/);
    expect(text).toMatch(
      /agentbadge_facilitator_up\{[^}]*target="gateway"[^}]*\} 1/,
    );
    expect(text).toMatch(
      /agentbadge_route_price_usd\{[^}]*route_key="readiness\.scan"[^}]*\} 0\.01/,
    );
  });

  it("label whitelist: payments series never expose PII labels", async () => {
    paymentsVerifyTotal.inc({ rail: "exact", network: "eip155:84532", result: "ok" });
    paymentsSettleTotal.inc({ rail: "arc", network: "eip155:5042002", result: "ok" });
    const text = await exposition();
    const series = text
      .split("\n")
      .filter(
        (l) =>
          !l.startsWith("#") &&
          (l.startsWith("agentbadge_payments_") ||
            l.startsWith("agentbadge_gateway_") ||
            l.startsWith("agentbadge_facilitator_") ||
            l.startsWith("agentbadge_route_price_")),
      );
    const ALLOWED = new Set([
      "rail",
      "network",
      "result",
      "reason_class",
      "route_key",
      "target",
      "le",
      "quantile",
      "service",
    ]);
    for (const line of series) {
      const m = line.match(/\{([^}]*)\}/);
      if (!m) continue;
      for (const pair of m[1].split(",")) {
        const key = pair.split("=")[0].trim();
        expect(
          ALLOWED.has(key),
          `forbidden label "${key}" in series: ${line}`,
        ).toBe(true);
      }
      // no raw addresses/txhashes as label values
      expect(line).not.toMatch(/="0x[0-9a-fA-F]+"/);
    }
  });
});

describe("runtime wiring", () => {
  it("deps.metrics hooks fire on paid request through paymentFor", async () => {
    const metrics = { onVerify: vi.fn(), onSettle: vi.fn() };
    const rt = createCirclePaymentsRuntime(BASE_CFG, {
      handles: { exact: fakeHandle() },
      metrics,
    });
    const app = new Hono();
    app.use("/paid", rt.paymentFor("readiness.scan") as never);
    app.get("/paid", (c) => c.json({ ok: true }));
    const res = await app.request("/paid", { headers: PAID_HEADERS });
    expect(res.status).toBe(200);
    expect(metrics.onVerify).toHaveBeenCalledWith(
      "exact",
      "eip155:84532",
      "ok",
      expect.any(Number),
    );
    expect(metrics.onSettle).toHaveBeenCalledWith(
      "exact",
      "eip155:84532",
      "ok",
      expect.any(Number),
    );
  });

  it("paymentFor registers route_price_usd gauge for the route key", async () => {
    const rt = createCirclePaymentsRuntime(BASE_CFG, {
      handles: { exact: fakeHandle() },
    });
    const app = new Hono();
    app.use("/p2", rt.paymentFor("readiness.scan") as never);
    app.get("/p2", (c) => c.json({ ok: true }));
    const text = await exposition();
    expect(text).toMatch(
      /agentbadge_route_price_usd\{[^}]*route_key="readiness\.scan"[^}]*\} 0\.01/,
    );
  });

  it("onFailure path increments paymentsFailuresTotal with normalized reason_class", async () => {
    const store = (await import("@agentbadge/circle-payments"))
      .createMemoryFailureStore();
    const userAlert = vi.fn();
    const rt = createCirclePaymentsRuntime(BASE_CFG, {
      handles: { exact: fakeHandle() },
      failureStore: store,
      onFailure: userAlert,
    });
    const app = new Hono();
    app.onError((e, c) => c.json({ error: e.message }, 500));
    app.use("/paid", rt.paymentFor("readiness.scan") as never);
    app.get("/paid", () => {
      throw new Error("fulfillment blew up");
    });
    const res = await app.request("/paid", { headers: PAID_HEADERS });
    expect(res.status).toBe(500);
    expect(userAlert).toHaveBeenCalled();
    const text = await exposition();
    const line = text
      .split("\n")
      .find(
        (l) =>
          l.startsWith("agentbadge_payments_failures_total") &&
          l.includes('reason_class="fulfillment"'),
      );
    expect(line).toBeTruthy();
  });
});
