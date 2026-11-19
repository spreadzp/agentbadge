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
import { getDatabase } from "../../lib/database";
import { invariants } from "../../lib/settlement/index.js";
import { milestoneVector } from "../../lib/settlement/services/plan-terms.js";
import {
  type MilestoneInput,
  fail,
} from "../../lib/settlement/types.js";
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
  const deps: SettlementRouteDeps = {
    // C1 — a public plan must match the commerce agreement it names:
    // same parties, same total. Anything else is a 403/404 — the plan
    // is the payout contract, it can't be authored around commerce.
    verifyAgreement: async (req) => {
      // M-H: resolve the DB through the injected seam, not the global.
      const db = deps.getDb?.() ?? getDatabase();
      const a = await db.commerce.agreements.getById(req.agreementRef);
      if (!a) {
        return fail(
          "NOT_FOUND",
          `commerce agreement not found: ${req.agreementRef}`,
        );
      }
      // R2-H1: dead agreements can't grow payout contracts.
      if (a.status === "CANCELLED") {
        return fail(
          "FORBIDDEN",
          `commerce agreement ${req.agreementRef} is CANCELLED`,
        );
      }
      try {
        if (
          a.buyerWallet.toLowerCase() !== req.buyerWallet.toLowerCase() ||
          a.providerWallet.toLowerCase() !==
            req.providerWallet.toLowerCase() ||
          invariants.decimalToMicro(a.agreedAmount) !==
            invariants.decimalToMicro(req.totalUsd)
        ) {
          return fail(
            "FORBIDDEN",
            "plan terms do not match the commerce agreement",
          );
        }
      } catch {
        // M-H: a malformed stored amount can't equal the request —
        // typed failure, not a 500.
        return fail(
          "FORBIDDEN",
          "commerce agreement amount is unreadable",
        );
      }
      // R2-H1: the milestone/leg/policy vector is part of the contract
      // — the offer payload's declared milestones are canonical; absent
      // → the bridge's own "full"-amount default.
      const offer = await db.commerce.offers.getById(a.offerId);
      const offered =
        offer?.payload && typeof offer.payload === "object"
          ? (offer.payload as Record<string, unknown>)["milestones"]
          : undefined;
      const canonical: MilestoneInput[] = Array.isArray(offered)
        ? (offered as MilestoneInput[]).slice()
        : [
            {
              milestoneId: "full",
              title: "Full delivery",
              amountUsd: a.agreedAmount,
            },
          ];
      const sort = (ms: MilestoneInput[]) =>
        ms.slice().sort((x, y) => x.milestoneId.localeCompare(y.milestoneId));
      if (
        milestoneVector(sort(req.milestones)) !==
        milestoneVector(sort(canonical))
      ) {
        return fail(
          "FORBIDDEN",
          "plan milestone terms do not match the offer",
        );
      }
      return null;
    },
  };
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
  // R2-H2: admin routes must receive the same seam deps — an unwired
  // mount silently downgrades mark-paid to blind attestation.
  deps.expectedPayer = process.env.ARC_SETTLEMENT_TREASURY_WALLET;
  deps.requireVerification =
    process.env.ARC_SETTLEMENT_REQUIRE_VERIFY === "1";
  app.route("/", createSettlementRoutes(deps)); // SLICE-227-3: /api/settlement/*
  app.route("/", createSettlementReceiptRoutes(deps)); // SLICE-227-4: receipts + anchor
  app.route("/", createSettlementAdminRoutes(deps)); // SLICE-227-3: /admin/settlement/*
}
