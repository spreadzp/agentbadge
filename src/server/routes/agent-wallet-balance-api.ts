// SLICE-155-5: agent wallet balance mirror + funding handoff.
// GET /api/wallets/:a/balance       — usdc/nativeUsdc/gateway+source
// GET /api/wallets/:a/deposit-qr.svg — QR for ethereum:{addr}@{chainId}
// Funding = read-only: transfer QR + verbatim `circle gateway
// deposit` handoff (owner runs it — money never via platform).

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { toString as qrToString } from "qrcode";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { AgentWalletStore } from "../lib/agent-wallet/registry";
import type { WalletBalance } from "../lib/agent-wallet/balance";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface BalanceRoutesDeps {
  store: AgentWalletStore;
  /** Injected reader — wiring binds cli+rpc+gateway; tests stub. */
  readBalance: (address: `0x${string}`) => Promise<WalletBalance>;
  /** EIP-155 numeric chain id (5042 Arc mainnet / 5042002 testnet). */
  chainId: number;
  /** Chain key for the verbatim deposit command. */
  chain: string;
}

export function createAgentWalletBalanceRoutes(
  deps: BalanceRoutesDeps,
): Hono {
  const routes = new Hono();

  const funding = (addr: `0x${string}`) => ({
    transfer: {
      uri: `ethereum:${addr}@${deps.chainId}`,
      network: `eip155:${deps.chainId}`,
      qrSvgPath: `/api/wallets/${addr}/deposit-qr.svg`,
      note: "Send USDC to this address on the Arc network.",
    },
    gatewayDeposit: {
      commandLine:
        `circle gateway deposit --address ${addr} --chain ${deps.chain} ` +
        "--amount <USD>",
      // SLICE-156-2: deposit instructions for every Gateway-covered chain.
      depositInfoUrl: "/api/pay/gateway/deposit-info",
      note:
        "Run in your own terminal (owner CLI). Optional — for " +
        "sub-500ms cross-chain spends via Circle Gateway.",
    },
    fiatOnramp: {
      url: "https://console.circle.com/",
      note: "Circle console → Wallet → Buy USDC (fiat on-ramp).",
    },
  });

  routes.get(
    "/api/wallets/:address/balance",
    describeRoute({
      description:
        "Wallet balance mirror — USDC (ERC-20 6dec) + native 18dec " +
        "view + optional Gateway balances; source cli|rpc|unavailable",
      responses: {
        200: { description: "{chain,usdc,nativeUsdc?,gateway?,source,funding}" },
        400: { description: "Invalid address" },
        404: { description: "Wallet not registered" },
      },
    }),
    async (c) => {
      const addr = c.req.param("address");
      if (!ADDRESS_RE.test(addr)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          "invalid address");
      }
      const rec = deps.store.get(addr);
      if (!rec || !rec.active) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered");
      }
      const bal = await deps.readBalance(rec.address);
      return c.json({ ...bal, funding: funding(rec.address) });
    },
  );

  routes.get(
    "/api/wallets/:address/deposit-qr.svg",
    describeRoute({
      description:
        "QR code (SVG) of ethereum:{address}@{chainId} — transfer " +
        "USDC on Arc to fund the wallet",
      responses: {
        200: { description: "image/svg+xml" },
        404: { description: "Wallet not registered" },
      },
    }),
    async (c) => {
      const addr = c.req.param("address");
      if (!ADDRESS_RE.test(addr)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          "invalid address");
      }
      const rec = deps.store.get(addr);
      if (!rec || !rec.active) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered");
      }
      const svg = await qrToString(
        `ethereum:${rec.address}@${deps.chainId}`,
        { type: "svg", margin: 2 },
      );
      return c.body(svg, 200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=300",
      });
    },
  );

  return routes;
}
