// EPIC-140 (SLICE-140-5): Circle nanopayments wiring extracted from index.ts.
// circleIdentityLookup + createCirclePaymentsRuntime + identity/demo routes +
// circle MCP tools (default "all" + market namespaces).
// marketNs is passed in from wiring/mcp-namespaces.ts (SLICE-140-6) — the
// namespace handle is created there, not duplicated here.

import type { Hono } from "hono";
import type { NamespaceRegistry } from "@agentbadge/mcp";
import { getNftsForAccount } from "@agentbadge/hedera-core";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";
import { createCirclePaymentsRuntime } from "../lib/circle-payments";
import { createIdentityRoutes } from "../routes/identity";
import { createDemoRoutes } from "../routes/demo";
import { captureError } from "../lib/sentry";
import {
  registerCirclePayTools,
  setCirclePayToolConfig,
} from "../../mcp/circle-pay-tools";
import {
  registerPaymentStatusTools,
  setPaymentStatusToolConfig,
} from "../../mcp/payment-status-tools";
import {
  registerAgentIdentityTools,
  setAgentIdentityToolConfig,
} from "../../mcp/agent-identity-tools";
import {
  registerCircleWalletBalanceTools,
  setCircleWalletBalanceToolConfig,
} from "../../mcp/circle-wallet-balance-tools";
import {
  registerSupportedNetworksTools,
  setSupportedNetworksToolConfig,
} from "../../mcp/supported-networks-tools";
import {
  registerPaymentHistoryTools,
  setPaymentHistoryToolConfig,
} from "../../mcp/payment-history-tools";

export function wireCirclePayments(app: Hono, ns: { marketNs: NamespaceRegistry }): void {
  const { marketNs } = ns;
  // Circle nanopayments (EPIC-129) — only when CIRCLE_PAYMENTS_ENABLED=true.
  // Master flag off → zero behavior change (old x402 paths stay as-is).
  const circleCfg = getConfig().circlePayments;

  /**
   * Passport lookup for the 402 identity extension + /api/identity route.
   * EVM address → Hedera account via mirror node → passport NFT check.
   * Server EOA (seller) has no Hedera account — falls back to the
   * operator account, which holds the server's own passport.
   */
  const MIRROR_BASE =
    getConfig().hederaNetwork === "mainnet"
      ? "https://mainnet.mirrornode.hedera.com/api/v1"
      : "https://testnet.mirrornode.hedera.com/api/v1";

  const circleIdentityLookup = async (
    address: string,
  ): Promise<
    | {
      passportTokenId: string;
      readinessScore?: number;
      mintTx?: string;
      issuedAt?: string;
      chain?: string;
    }
    | undefined
  > => {
    const cfg = getConfig();
    let accountId: string | undefined;
    try {
      const res = await fetch(`${MIRROR_BASE}/accounts/${address}`);
      if (res.ok) {
        const data = (await res.json()) as { account?: string };
        accountId = data.account;
      }
    } catch {
      /* fall through to seller fallback */
    }
    if (
      !accountId &&
      circleCfg &&
      address.toLowerCase() === circleCfg.sellerAddress.toLowerCase()
    ) {
      accountId = cfg.hederaOperatorId;
    }
    if (!accountId) return undefined;

    const nfts = await getNftsForAccount(accountId);
    const nft = nfts.find(
      (n) => n.token_id === cfg.passportTokenId && !n.deleted,
    );
    if (!nft) return undefined;
    return {
      passportTokenId: `${nft.token_id}:${nft.serial_number}`,
      issuedAt: new Date(
        Number(nft.created_timestamp.split(".")[0]) * 1000,
      ).toISOString(),
      chain: "hedera",
    };
  };

  if (circleCfg?.enabled) {
    try {
      const circleRuntime = createCirclePaymentsRuntime(circleCfg, {
        identityLookup: circleIdentityLookup,
        onFailure: (f) => {
          logger.error("Payment fulfillment failure after confirmed settle", {
            scheme: f.scheme,
            network: f.network,
            payer: f.payer,
            amount: f.amount,
            reason: f.reason,
            txRef: f.txRef,
          });
          captureError(new Error(`payment-fulfillment: ${f.reason}`), {
            tags: { scheme: f.scheme, network: f.network },
          });
        },
      });
      if (circleCfg.identity) {
        app.route(
          "/",
          createIdentityRoutes({
            payment: circleRuntime.paymentFor("identity.verify"),
            lookup: circleRuntime.lookup,
          }),
        );
      }
      // SLICE-129-23: demo pair — verified (extension) vs raw (no extension)
      app.route(
        "/",
        createDemoRoutes({
          verifiedPayment: circleRuntime.paymentFor("demo.data"),
          rawPayment: circleRuntime.paymentFor("demo.data", {
            identity: false,
          }),
        }),
      );
      // SLICE-129-15/16: circle MCP tools — "all" + market namespaces
      setCirclePayToolConfig({ router: circleRuntime.router });
      registerCirclePayTools();
      registerCirclePayTools(marketNs);
      setPaymentStatusToolConfig({ statusLookup: circleRuntime.statusLookup });
      registerPaymentStatusTools();
      registerPaymentStatusTools(marketNs);
      setAgentIdentityToolConfig({ lookup: circleRuntime.lookup });
      registerAgentIdentityTools();
      registerAgentIdentityTools(marketNs);
      setCircleWalletBalanceToolConfig({
        balanceLookup: circleRuntime.balanceLookup,
      });
      registerCircleWalletBalanceTools();
      registerCircleWalletBalanceTools(marketNs);
      setSupportedNetworksToolConfig({
        router: circleRuntime.router,
        getFlags: () => {
          const c = getConfig().circlePayments;
          return {
            gateway: c?.gateway ?? false,
            arc: c?.arc ?? false,
            identity: c?.identity ?? false,
            escrow: c?.escrow ?? false,
          };
        },
      });
      registerSupportedNetworksTools();
      registerSupportedNetworksTools(marketNs);
      setPaymentHistoryToolConfig({
        paymentHistory: circleRuntime.paymentHistory,
      });
      registerPaymentHistoryTools();
      registerPaymentHistoryTools(marketNs);
      logger.info("Circle payments wired", {
        gateway: circleCfg.gateway,
        arc: circleCfg.arc,
        identity: circleCfg.identity,
      });
    } catch (e) {
      logger.error("Failed to wire circle payments — feature disabled", {
        error: e instanceof Error ? e.message : String(e),
      });
      captureError(e instanceof Error ? e : new Error(String(e)), {
        tags: { feature: "circle-payments" },
      });
    }
  }
}
