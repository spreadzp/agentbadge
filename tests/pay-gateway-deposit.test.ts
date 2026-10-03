/**
 * SLICE-156-2: GET /api/pay/gateway/deposit-info + deposit-qr.svg tests.
 *
 * Verifies per-chain GatewayWallet/USDC addresses, minDeposit env
 * override, QR endpoint shape and unknown-chain 400. Data comes from
 * chains.ts — no facilitator IO.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  ARC_TESTNET,
  BASE_SEPOLIA,
} from "@agentbadge/circle-payments";
import {
  createGatewayDepositRoutes,
  gatewayChainsFor,
} from "../src/server/routes/pay-gateway";
import type { CirclePaymentsConfig } from "../src/config/env";

const SELLER = "0x1111111111111111111111111111111111111111";

function cfg(over: Partial<CirclePaymentsConfig> = {}): CirclePaymentsConfig {
  return {
    enabled: true,
    gateway: true,
    arc: false,
    identity: false,
    escrow: false,
    gatewayApiUrl: "https://gateway-api-testnet.circle.com",
    arcRpcUrl: "https://rpc.testnet.arc.network",
    arcChainId: 5042002,
    arcMainnet: false,
    arcMainnetRpcUrl: "https://rpc.mainnet.arc.io",
    attestation: false,
    sellerAddress: SELLER,
    platformFeeBps: 0,
    gatewayMinDepositUsd: "0.10",
    ...over,
  };
}

function app(over: Partial<CirclePaymentsConfig> = {}) {
  const a = new Hono();
  a.route("/", createGatewayDepositRoutes(cfg(over)));
  return a;
}

describe("GET /api/pay/gateway/deposit-info", () => {
  it("emits correct gatewayWallet/usdc per default chains", async () => {
    const res = await app().request("/api/pay/gateway/deposit-info");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      minDeposit: string;
      chains: Array<{
        network: string;
        gatewayWallet: string;
        usdc: string;
        minDeposit: string;
        creditEstimateSec: number;
        transferUri: string;
      }>;
      howto: string;
    };
    expect(body.minDeposit).toBe("0.10");
    expect(body.chains.map((c) => c.network)).toEqual([
      "eip155:84532",
      "eip155:5042002",
    ]);
    const base = body.chains[0]!;
    expect(base.gatewayWallet).toBe(BASE_SEPOLIA.gatewayWallet);
    expect(base.usdc).toBe(BASE_SEPOLIA.usdc);
    expect(base.creditEstimateSec).toBeGreaterThan(0);
    expect(body.howto).toMatch(/unified balance/);
  });

  it("respects env minDeposit and CIRCLE_GATEWAY_CHAINS override", async () => {
    const res = await app({
      gatewayMinDepositUsd: "0.25",
      gatewayChains: [ARC_TESTNET],
    }).request("/api/pay/gateway/deposit-info");
    const body = (await res.json()) as { minDeposit: string; chains: unknown[] };
    expect(body.minDeposit).toBe("0.25");
    expect(body.chains).toHaveLength(1);
  });

  it("arcMainnet swaps Arc testnet → mainnet in defaults", () => {
    const chains = gatewayChainsFor(cfg({ arcMainnet: true }));
    expect(chains.map((c) => c.caip2)).toEqual([
      "eip155:84532",
      "eip155:5042",
    ]);
  });
});

describe("GET /api/pay/gateway/deposit-qr.svg", () => {
  it("returns SVG QR of the GatewayWallet for a known chain", async () => {
    const res = await app().request(
      "/api/pay/gateway/deposit-qr.svg?chain=eip155:84532",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });

  it("accepts numeric chain id", async () => {
    const res = await app().request(
      "/api/pay/gateway/deposit-qr.svg?chain=5042002",
    );
    expect(res.status).toBe(200);
  });

  it("400 on unknown / non-gateway chain", async () => {
    const res = await app().request(
      "/api/pay/gateway/deposit-qr.svg?chain=eip155:99999999",
    );
    expect(res.status).toBe(400);
  });
});
