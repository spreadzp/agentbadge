/**
 * EPIC-227 — settlement route registration + prod seam wiring.
 *
 * Extracted from routes/index.ts (20KB staged-file cap). Wires:
 *  - receipt signer from ARC_RECEIPT_SIGNER_KEY ?? ARC_OPS_KEY
 *    (task-receipt EOA family), bound to the resolved Arc chain id;
 *  - memo-anchor send seam when ARC_SETTLEMENT_MEMO_ANCHOR=1 — EOA
 *    send over the ops wallet targeting net.memo (self-anchor);
 *    absent → POST anchor still enqueues durable PENDING rows.
 */
import type { Hono } from "hono";

import { getConfig } from "../../../config/env";
import { mkEoaSend } from "../../lib/eaas/anchor";
import { keyWallet, opsKey } from "../../lib/eaas/keys";
import { arcChainFor } from "../../lib/marketplace/chain";
import { createSettlementReceiptSigner } from "../../lib/settlement/receipt";
import { publicClient, resolveVenueNetwork } from "../../lib/venue/chain";

import type { SettlementRouteDeps } from "./helpers";
import { createSettlementAdminRoutes } from "./settlement-admin";
import { createSettlementReceiptRoutes } from "./settlement-receipts";
import { createSettlementRoutes } from "./settlement";

export function registerSettlementRoutes(app: Hono): void {
  const deps: SettlementRouteDeps = {};
  const evm = getConfig().evm;
  const receiptKey =
    process.env.ARC_RECEIPT_SIGNER_KEY ?? process.env.ARC_OPS_KEY;
  const net = resolveVenueNetwork();
  const chain = arcChainFor(
    getConfig().bstock?.arcNetwork ?? net.chain.caip2,
  );
  const chainId = chain?.id ?? evm?.chainId;
  if (receiptKey && chainId) {
    deps.signer = createSettlementReceiptSigner(receiptKey, chainId);
    deps.chainId = chainId;
    if (process.env.ARC_SETTLEMENT_MEMO_ANCHOR === "1") {
      const ops = keyWallet(opsKey(), chain, net.chain.rpcUrl);
      if (ops.wallet && ops.account) {
        deps.anchorSend = mkEoaSend({
          wallet: ops.wallet,
          account: ops.account,
          read: publicClient(net),
          chain,
        });
        deps.memo = net.memo;
        deps.selfAddress = ops.account.address;
      }
    }
  }
  app.route("/", createSettlementRoutes(deps)); // SLICE-227-3: /api/settlement/*
  app.route("/", createSettlementReceiptRoutes(deps)); // SLICE-227-4: receipts + anchor
  app.route("/", createSettlementAdminRoutes()); // SLICE-227-3: /admin/settlement/*
}
